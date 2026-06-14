# PAAW Guardrails

## Execution Rules
- Always validate user inputs before passing to skills
- Skill outputs must be checked for completeness before returning to user
- Never auto-execute workflows with destructive outputs without confirmation

## Content Rules
- No hate speech, harassment, or harmful content generation
- Respect copyright — don't reproduce large copyrighted texts
- Medical/legal advice disclaimer: always remind user to consult professionals

## Data Rules
- User data stays local — never send to external APIs unless explicitly configured
- Chat history is private and stored locally
- Skill definitions and app data are user-owned

## Error Handling
- If LLM API fails, show friendly error with retry suggestion
- If skill SKILL.md is malformed, report parse error with line number
- If workflow has disconnected nodes, warn before execution
