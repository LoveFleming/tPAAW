# Error Code Registry & Runbooks

## 1. Error Code Registry

| Error Code | Message | HTTP Status | Feature | File | Line | Runbook |
|-----------|---------|-------------|---------|------|------|---------|
| CU-001 | Code Understanding analysis failed | 500 | Code Understanding | src/features/code-understanding/analyzer.mjs | 42 | runbooks/cu-001.md |
| CU-002 | Invalid project path for analysis | 400 | Code Understanding | src/features/code-understanding/scanner.mjs | 18 | runbooks/cu-002.md |
| SEM-001 | Semgrep scan failed | 500 | Security Scanning | src/features/security/semgrep.mjs | 55 | runbooks/sem-001.md |
| SEM-002 | Semgrep rule not found | 404 | Security Scanning | src/features/security/semgrep.mjs | 72 | runbooks/sem-002.md |
| TS-001 | Tree-sitter parse error | 500 | Source Analysis | src/features/tree-sitter/parser.mjs | 30 | runbooks/ts-001.md |
| TS-002 | Unsupported language for Tree-sitter | 400 | Source Analysis | src/features/tree-sitter/parser.mjs | 15 | runbooks/ts-002.md |
| FM-001 | Feature map generation failed | 500 | Feature Mapping | src/features/feature-map/generator.mjs | 60 | runbooks/fm-001.md |
| FM-002 | Feature map JSON parse error | 400 | Feature Mapping | src/features/feature-map/generator.mjs | 78 | runbooks/fm-002.md |
| AI-001 | AI provider connection timeout | 503 | AI Integration | src/providers/provider.mjs | 25 | runbooks/ai-001.md |
| AI-002 | AI response empty or whitespace | 502 | AI Integration | src/providers/provider.mjs | 40 | runbooks/ai-002.md |
| AI-003 | Invalid AI model configuration | 400 | AI Integration | src/providers/provider.mjs | 12 | runbooks/ai-003.md |
| AUTH-001 | Token expired | 401 | Authentication | src/middleware/auth.mjs | 20 | runbooks/auth-001.md |
| AUTH-002 | Invalid API key | 403 | Authentication | src/middleware/auth.mjs | 35 | runbooks/auth-002.md |
| SYS-500 | Internal server error | 500 | System | src/app.mjs | 1 | runbooks/sys-500.md |

## 2. API → Exception → Error Code → Runbook Chain

```
POST /api/code-understanding/analyze
  ├─ CU-001: Analysis failed (500) → runbooks/cu-001.md
  ├─ CU-002: Invalid project path (400) → runbooks/cu-002.md
  ├─ AUTH-001: Token expired (401) → runbooks/auth-001.md
  └─ SYS-500: Internal server error (500) → runbooks/sys-500.md

POST /api/security/scan
  ├─ SEM-001: Semgrep scan failed (500) → runbooks/sem-001.md
  ├─ SEM-002: Rule not found (404) → runbooks/sem-002.md
  ├─ AUTH-001: Token expired (401) → runbooks/auth-001.md
  └─ SYS-500: Internal server error (500) → runbooks/sys-500.md

POST /api/source-analysis/parse
  ├─ TS-001: Parse error (500) → runbooks/ts-001.md
  ├─ TS-002: Unsupported language (400) → runbooks/ts-002.md
  ├─ AUTH-001: Token expired (401) → runbooks/auth-001.md
  └─ SYS-500: Internal server error (500) → runbooks/sys-500.md

POST /api/feature-map/generate
  ├─ FM-001: Generation failed (500) → runbooks/fm-001.md
  ├─ FM-002: JSON parse error (400) → runbooks/fm-002.md
  ├─ AUTH-001: Token expired (401) → runbooks/auth-001.md
  └─ SYS-500: Internal server error (500) → runbooks/sys-500.md

POST /api/ai/chat
  ├─ AI-001: Connection timeout (503) → runbooks/ai-001.md
  ├─ AI-002: Empty response (502) → runbooks/ai-002.md
  ├─ AI-003: Invalid model config (400) → runbooks/ai-003.md
  ├─ AUTH-001: Token expired (401) → runbooks/auth-001.md
  └─ SYS-500: Internal server error (500) → runbooks/sys-500.md
```

## 3. Runbooks

### runbooks/cu-001.md
```markdown
## CU-001: Code Understanding Analysis Failed

### Symptom
API returns 500 with message "Code Understanding analysis failed"

### Root Cause
- Internal error during code analysis (e.g., file system error, memory limit)
- Dependency failure (e.g., Tree-sitter, Semgrep)
- Unexpected project structure

### Debugging Steps
1. Check server logs for stack trace
2. Verify project path exists and is readable
3. Check available memory and CPU
4. Test with a minimal project to isolate issue

### Fix
- Restart the analysis service
- Increase resource limits if memory/CPU exhausted
- Update dependencies to latest compatible versions
- If persistent, escalate to development team

### Related Code
- Handler: src/features/code-understanding/analyzer.mjs:analyze()
- Model: src/models/analysis.mjs
- Test: tests/code-understanding.test.mjs
```

### runbooks/cu-002.md
```markdown
## CU-002: Invalid Project Path for Analysis

### Symptom
API returns 400 with message "Invalid project path for analysis"

### Root Cause
- Project path does not exist on server
- Path is a file instead of a directory
- Path contains invalid characters or is empty

### Debugging Steps
1. Verify the project path in the request
2. Check if the path exists: `ls -la <path>`
3. Ensure the path is a directory: `test -d <path>`
4. Validate path format (no special characters)

### Fix
- Correct the project path in the request
- If path is relative, ensure it resolves correctly
- Provide absolute path if possible

### Related Code
- Handler: src/features/code-understanding/scanner.mjs:validatePath()
- Model: src/models/project.mjs
- Test: tests/code-understanding.test.mjs
```

### runbooks/sem-001.md
```markdown
## SEM-001: Semgrep Scan Failed

### Symptom
API returns 500 with message "Semgrep scan failed"

### Root Cause
- Semgrep binary not installed or not in PATH
- Semgrep configuration file missing or invalid
- Network timeout when downloading rules
- Out of memory during scan

### Debugging Steps
1. Check if Semgrep is installed: `semgrep --version`
2. Verify Semgrep config file exists: `cat .semgrep.yml`
3. Run Semgrep manually on a small file to test
4. Check server logs for Semgrep error output

### Fix
- Install Semgrep: `pip install semgrep` or use Docker
- Create or fix `.semgrep.yml` configuration
- Increase memory limit for the scan process
- Retry the scan after resolving issues

### Related Code
- Handler: src/features/security/semgrep.mjs:runScan()
- Model: src/models/scan.mjs
- Test: tests/security.test.mjs
```

### runbooks/sem-002.md
```markdown
## SEM-002: Semgrep Rule Not Found

### Symptom
API returns 404 with message "Semgrep rule not found"

### Root Cause
- Requested rule ID does not exist in the rules registry
- Rule file was deleted or renamed
- Rule is not loaded due to configuration error

### Debugging Steps
1. List available rules: `semgrep --list-rules`
2. Check the rule registry file: `cat src/features/security/rules.json`
3. Verify rule ID spelling in the request

### Fix
- Use a valid rule ID from the registry
- Add missing rule to the registry if needed
- Update the rule file path in configuration

### Related Code
- Handler: src/features/security/semgrep.mjs:getRule()
- Model: src/models/rule.mjs
- Test: tests/security.test.mjs
```

### runbooks/ts-001.md
```markdown
## TS-001: Tree-sitter Parse Error

### Symptom
API returns 500 with message "Tree-sitter parse error"

### Root Cause
- Source file contains syntax errors
- Tree-sitter grammar not installed for the language
- File encoding is not UTF-8
- File is too large (memory limit)

### Debugging Steps
1. Check the source file for syntax errors manually
2. Verify Tree-sitter grammar is installed: `npm list tree-sitter-<language>`
3. Check file encoding: `file <filename>`
4. Check file size: `wc -c <filename>`

### Fix
- Fix syntax errors in the source file
- Install missing grammar: `npm install tree-sitter-<language>`
- Convert file to UTF-8 encoding
- Increase memory limit or split large files

### Related Code
- Handler: src/features/tree-sitter/parser.mjs:parse()
- Model: src/models/ast.mjs
- Test: tests/tree-sitter.test.mjs
```

### runbooks/ts-002.md
```markdown
## TS-002: Unsupported Language for Tree-sitter

### Symptom
API returns 400 with message "Unsupported language for Tree-sitter"

### Root Cause
- Language is not in the supported list (e.g., JavaScript, Python, Java)
- Language detection failed (file extension not recognized)
- Grammar not installed for the detected language

### Debugging Steps
1. Check the file extension of the source file
2. Verify supported languages list: `cat src/features/tree-sitter/languages.json`
3. If language is supported, ensure grammar is installed

### Fix
- Use a supported language or add support for the new language
- Correct file extension to match a supported language
- Install grammar for the language if missing

### Related Code
- Handler: src/features/tree-sitter/parser.mjs:detectLanguage()
- Model: src/models/language.mjs
- Test: tests/tree-sitter.test.mjs
```

### runbooks/fm-001.md
```markdown
## FM-001: Feature Map Generation Failed

### Symptom
API returns 500 with message "Feature map generation failed"

### Root Cause
- Internal error during feature extraction (e.g., AST traversal failure)
- Dependency on Tree-sitter or other analyzers failed
- Output file write error (permissions, disk full)

### Debugging Steps
1. Check server logs for detailed error
2. Verify that source analysis (Tree-sitter) completed successfully
3. Check disk space and write permissions for output directory
4. Test with a small project to isolate

### Fix
- Retry the generation after fixing underlying analysis issues
- Ensure output directory exists and is writable
- Increase disk space if necessary

### Related Code
- Handler: src/features/feature-map/generator.mjs:generate()
- Model: src/models/featuremap.mjs
- Test: tests/feature-map.test.mjs
```

### runbooks/fm-002.md
```markdown
## FM-002: Feature Map JSON Parse Error

### Symptom
API returns 400 with message "Feature map JSON parse error"

### Root Cause
- LLM returned malformed JSON
- JSON contains unexpected fields or types
- JSON is empty or truncated

### Debugging Steps
1. Check the raw LLM response in logs
2. Validate JSON manually: `echo '<response>' | jq .`
3. Check for common issues: trailing commas, unescaped strings

### Fix
- Retry the request (LLM may return valid JSON on retry)
- Adjust prompt to enforce strict JSON output
- Implement fallback parsing with error recovery

### Related Code
- Handler: src/features/feature-map/generator.mjs:parseResponse()
- Model: src/models/featuremap.mjs
- Test: tests/feature-map.test.mjs
```

### runbooks/ai-001.md
```markdown
## AI-001: AI Provider Connection Timeout

### Symptom
API returns 503 with message "AI provider connection timeout"

### Root Cause
- AI provider (e.g., OpenAI, GLM) is unreachable
- Network issues (DNS, firewall, proxy)
- Provider rate limiting or overload
- Request timeout too short

### Debugging Steps
1. Check network connectivity: `ping api.openai.com`
2. Verify API endpoint URL in configuration
3. Check provider status page for outages
4. Increase timeout in configuration

### Fix
- Retry the request with exponential backoff
- Switch to a fallback provider if available
- Update network/firewall rules
- Adjust timeout settings in `src/providers/provider.mjs`

### Related Code
- Handler: src/providers/provider.mjs:callAI()
- Model: src/models/ai-response.mjs
- Test: tests/ai-provider.test.mjs
```

### runbooks/ai-002.md
```markdown
## AI-002: AI Response Empty or Whitespace

### Symptom
API returns 502 with message "AI response empty or whitespace"

### Root Cause
- AI provider returned an empty string or only whitespace
- Response was filtered by content safety checks
- Network issue caused incomplete response

### Debugging Steps
1. Check raw response from provider in logs
2. Verify that the prompt is not empty or malformed
3. Check provider's content filter settings
4. Retry with a different prompt

### Fix
- Implement automatic retry with same prompt (as per git log fix)
- Adjust prompt to avoid triggering content filters
- Increase response length limit if applicable

### Related Code
- Handler: src/providers/provider.mjs:handleResponse()
- Model: src/models/ai-response.mjs
- Test: tests/ai-provider.test.mjs
```

### runbooks/ai-003.md
```markdown
## AI-003: Invalid AI Model Configuration

### Symptom
API returns 400 with message "Invalid AI model configuration"

### Root Cause
- Model name is not recognized by the provider
- Missing required parameters (e.g., API key, temperature)
- Configuration file is malformed or missing

### Debugging Steps
1. Check the model name in the request against provider's supported models
2. Verify API key is set and valid
3. Validate configuration file: `cat config/ai.json`
4. Check environment variables for required settings

### Fix
- Use a valid model name from the provider's list
- Set missing parameters in configuration
- Correct syntax errors in configuration file
- Ensure API key is provided via environment variable

### Related Code
- Handler: src/providers/provider.mjs:validateConfig()
- Model: src/models/ai-config.mjs
- Test: tests/ai-provider.test.mjs
```

### runbooks/auth-001.md
```markdown
## AUTH-001: Token Expired

### Symptom
API returns 401 with message "