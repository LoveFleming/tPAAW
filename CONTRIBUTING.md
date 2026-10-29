# Contributing to PAAW

感謝你想貢獻！Thanks for contributing!

## Dev setup

```bash
npm install
cp data/config/providers.example.json data/config/providers.json  # fill in a key
npm run dev          # UI :5173 + API :4097
```

Before sending a PR:

```bash
npm run typecheck
npm test             # vitest unit tests（需先 cp data/config/providers.example.json data/config/providers.json，假 key 即可）
npm run build        # must pass
```

## Ground rules

### Cross-platform paths (important!)

PAAW runs on macOS, Windows and Linux.

- ❌ Never use `new URL(import.meta.url).pathname` — breaks on Windows (`/C:/...`)
- ✅ Always use `fileURLToPath(import.meta.url)` for `__filename`/`__dirname`
- ✅ Paths returned to the frontend go through `normalizePath()` (`\` → `/`)
- ✅ Split paths with `split(/[\\/]/)`, never a hardcoded `"/"`
- ❌ Never use Unix `find` in server code — use Node `readdirSync`/`statSync`

### i18n

UI strings go through `t()` with a key in **all four** locale files:
`packages/ui/src/i18n/locales/{zh,en,ja,zh-mix}.json` — key naming `category.subcategory`.
No hardcoded user-facing strings.

### Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:` …). Keep commits focused;
every commit should leave the app buildable.

### Security

- Never commit real API keys — `providers.json` and `.env` are gitignored on purpose
- New tool surface needs a security-kernel policy review (`packages/server/src/lib/security/`)
- Tool execution must stay sandboxed; dangerous commands require approval cards

### Data boundaries

`data/` contains product seed content (prompts, skills, apps, workflows, crews).
Personal/runtime data (chats, app-data, notes, logs) is gitignored — do not add
personal data to the repo.

## Releasing

`node scripts/pack.mjs` builds a distributable zip from the current tree.

## Where to help

- 🌍 i18n improvements and new languages
- 🧩 New example skills / apps (App Builder templates)
- 📖 Docs and tutorials
- 🐛 Bug fixes — see Issues
