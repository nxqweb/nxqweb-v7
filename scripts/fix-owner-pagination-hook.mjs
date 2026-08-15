import fs from "node:fs";

const path = "src/pages/OwnerPortal.tsx";
let source = fs.readFileSync(path, "utf8");

source = source.replace(
  'import { useEffect, useMemo, useState } from "react";',
  'import { useCallback, useEffect, useMemo, useState } from "react";',
);

const startNeedle = '  async function loadOwnerData() {';
const endNeedle = '\n\n  async function updateApprovalStatus';
const start = source.indexOf(startNeedle);
const end = source.indexOf(endNeedle, start);
if (start < 0 || end < 0) throw new Error("loadOwnerData block not found");

let block = source.slice(start, end);
block = block.replace(startNeedle, '  const loadOwnerData = useCallback(async (searchValue = "") => {');
block = block.replace(
  '          target_search: clientSearch.trim() || null,',
  '          target_search: searchValue.trim() || null,',
);
if (!block.includes('target_search: searchValue.trim() || null')) {
  throw new Error("loadOwnerData search argument was not stabilized");
}
block = block.replace(/\n  \}$/, '\n  }, []);');
source = source.slice(0, start) + block + source.slice(end);

source = source.replaceAll('await loadOwnerData();', 'await loadOwnerData(clientSearch);');
source = source.replace(
  '  useEffect(() => {\n    loadOwnerData();\n  }, []);',
  '  useEffect(() => {\n    void loadOwnerData("");\n  }, [loadOwnerData]);',
);

if (!source.includes('useCallback(async (searchValue = "")')) throw new Error("useCallback conversion missing");
if (!source.includes('}, [loadOwnerData]);')) throw new Error("useEffect dependency conversion missing");

fs.writeFileSync(path, source);
console.log("Stabilized scalable Owner Portal initial loader with useCallback.");
