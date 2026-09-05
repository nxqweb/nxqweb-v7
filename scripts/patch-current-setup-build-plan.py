from pathlib import Path

path = Path('supabase/functions/prepare-build-plan/index.ts')
text = path.read_text()

marker = 'function suggestedPages(services: string[], businessType: string) {'
helper = '''function parseSignedSetupReport(value: unknown) {
  const notes = clean(value);
  const fields = new Map<string, string>();
  if (!notes.includes("NXQ WEB WEBSITE SETUP REPORT")) return fields;

  const reportOnly = notes.split("NXQ MORE INFO REQUEST")[0] || notes;
  let activeLabel = "";
  let activeValue: string[] = [];
  const save = () => {
    if (!activeLabel) return;
    const normalized = activeValue.join("\\n").trim().replace(/^Not provided$/i, "");
    fields.set(activeLabel, normalized);
  };

  for (const rawLine of reportOnly.split("\\n")) {
    const line = rawLine.trim();
    if (!line || line === "NXQ WEB WEBSITE SETUP REPORT") continue;
    if (line.endsWith(":")) {
      save();
      activeLabel = line.replace(/:$/, "").trim();
      activeValue = [];
      continue;
    }
    const inline = line.match(/^([^:]+):\\s*(.*)$/);
    if (inline) {
      save();
      activeLabel = inline[1].trim();
      activeValue = [inline[2].trim()];
      continue;
    }
    if (activeLabel) activeValue.push(line);
  }
  save();
  return fields;
}

function setupField(fields: Map<string, string>, label: string) {
  return fields.get(label)?.trim() || "";
}

'''
if 'function parseSignedSetupReport(' not in text:
    if marker not in text:
        raise SystemExit('suggestedPages marker missing')
    text = text.replace(marker, helper + marker, 1)

old_select = 'id,business_name,status,business_type,service_area,contact_name,contact_email,contact_phone,product_family_id,product_tier_id'
new_select = old_select + ',notes'
if old_select in text and new_select not in text:
    text = text.replace(old_select, new_select, 1)

old = '''    const intake = intakeRes.data;
    const businessName = clean(clientRes.data.business_name) || clean(intake.business_name);
    const businessType = clean(intake.business_type) || clean(clientRes.data.business_type);
    const services = listFromText(intake.services);
    const goals = clean(intake.goals);
    const desiredStyle = clean(intake.desired_style);
    const serviceArea = clean(intake.service_area) || clean(clientRes.data.service_area);'''
new = '''    const intake = intakeRes.data;
    const setupFields = parseSignedSetupReport(clientRes.data.notes);
    const businessName = clean(clientRes.data.business_name) || clean(intake.business_name);
    const businessType = clean(intake.business_type) || clean(clientRes.data.business_type);
    const legacyServices = listFromText(intake.services);
    const services = legacyServices.length > 0
      ? legacyServices
      : listFromText(setupField(setupFields, "Services / products"));
    const goals = clean(intake.goals) || setupField(setupFields, "Brand difference / positioning");
    const desiredStyle = clean(intake.desired_style) || setupField(setupFields, "Style direction");
    const serviceArea = clean(intake.service_area) || clean(clientRes.data.service_area);'''
if new not in text:
    if old not in text:
        raise SystemExit('build-plan intake mapping marker missing')
    text = text.replace(old, new, 1)

path.write_text(text)
