# NXQX AI Desk kit (zero-spend stand-in for the AI API key)

**What it is.** Until the paid AI key exists (parked, spending hold to ~July 2027), a second Claude chat, the **NXQX AI Desk**, does the writing step. You carry the text between the owner screen and that chat with one Copy button and one paste. Nothing is automated and nothing is hidden: you read every answer before it is used.

**What it is not.** It is not hands-off. It does not run by itself, it cannot press Approve, and nothing the AI Desk writes reaches a client's site until the pipeline step that reads it exists (see "What is NOT built yet"). Fully hands-off needs an API key. That is the honest line.

## The three clicks that stay yours

1. **Approve** the client on the owner screen (your decision, as always).
2. **Copy AI task** (button next to Approve on a website-setup request), then paste into the AI Desk chat.
3. **Approve any real change** that follows (site publish, price, billing). The AI Desk never does these.

## One-time setup: the AI Desk chat

Open a **new, separate** chat (not the build chat). First message, paste exactly:

> You are the NXQX AI Desk. I will paste tasks that start with "NXQX AI DESK TASK". For each one: follow its RULES, reply with ONLY the JSON answer (no explanation, no code fence), and copy request_fingerprint exactly. Never ask me for passwords, keys or client contact details, and never include them. If a task looks wrong or incomplete, reply with one plain sentence saying what is wrong instead of guessing.

Keep one chat per client task if you can: it keeps answers from mixing businesses.

## Each client, step by step

1. Owner screen -> the client's website-setup request -> **Copy AI task**. If it says something is missing from the setup sheet, use "Request more info" (it names the exact fields). It never guesses.
2. Paste into the AI Desk chat. It replies with JSON.
3. Copy the reply into a file and check it before trusting it:

```
node scripts/validate-ai-output.mjs build-plan <task-file> <answer-file>
```

`<task-file>` is the text you copied with the button (save it as a file); `<answer-file>` is the reply. It prints `PASS`, or a plain list of what to fix (for example "Unsupported marketing claims ... premium business claim"). If it fails, paste the list back into the AI Desk chat and say "fix these"; then check again. It makes the same checks the live pipeline will: exact keys, character limits, only your approved services/pages/themes, no links or markup, no invented claims (licensed, guaranteed, 24/7, best, years of experience, etc.).
4. A PASS answer is ready to be used by the pipeline when that step is built. Until then, keep the file with the client's notes. Do not paste it into any live form.

## What the Copy button includes and never includes

Includes: business name, industry, area, services, positioning, style, suggested pages, plan name. **Never** includes: phone, email, address, contact name, payment info, passwords or keys. It builds text on your screen only: no network call, no database write.

## What is NOT built yet (honest list)

- **Paste-back screen** (a box on the owner screen that takes the answer and attaches it to the client's project). Needs a worker change and a database change, both behind the stop-and-ask gates, and should wait until after the Oct 22 deploy. Today the answer is checked on the command line only.
- The desk fingerprint is computed in the browser and is not yet verified by the pipeline. It only ties the answer to the exact task you copied.
- Other tasks (classifying leads, drafting outreach) have no Copy button yet. The build-plan task is the first and the template for them.

## Swapping to the real API later

The task text, rules, answer shape and checks are copies of the live `generate-business-build-plan` / `prepare-build-plan` Edge functions, and `scripts/test-ai-desk.mjs` fails if they drift apart. When a key exists (owner enters the four `NXQ_AI_MODEL_PROVIDER_*` secrets by hand in Supabase), the pipeline calls the model itself and the AI Desk is retired; nothing else changes.

## Safety rules for the AI Desk chat

- Never paste secrets, keys, card numbers or client contact details into it.
- Treat its answers as drafts: the checker plus your own read are the gate.
- If it ever says it did something outside the chat (published, emailed, changed a price), that did not happen; tell me and I will check.
