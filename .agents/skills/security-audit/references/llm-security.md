# LLM / AI Security Reference

A security inspection guide for LLM applications based on the OWASP Top 10 for LLM Applications (2025).

## LLM01: Prompt Injection

### Risk

An attacker manipulates prompts to steer the LLM's behavior in unintended directions. This includes direct injection (via user input) and indirect injection (via external data sources).

### Inspection Patterns

```bash
# Locations where user input is directly concatenated into prompts
grep -rn --include='*.{ts,js,py,rb,go}' \
  -E '(prompt|system_message|messages).*(\+|concat|format|f['\''"]|template|`\$\{)' \
  . 2>/dev/null | grep -v node_modules

# Detect prompt templates
grep -rn --include='*.{ts,js,py}' \
  -E '(ChatPromptTemplate|PromptTemplate|SystemMessage|HumanMessage)' \
  . 2>/dev/null | grep -v node_modules

# Check for user input sanitization
grep -rn --include='*.{ts,js,py}' \
  -iE '(sanitize|escape|filter|validate).*prompt' \
  . 2>/dev/null | grep -v node_modules

# Detect prompt guards / input filtering
grep -rn --include='*.{ts,js,py}' \
  -iE '(prompt.?guard|input.?filter|content.?filter|moderation|guardrail)' \
  . 2>/dev/null | grep -v node_modules
```

**Mitigations**:
- Clearly separate system prompts from user input
- Apply input length limits and sanitization
- Validate LLM output (output guardrails)
- Minimize permissions (restrict actions the LLM can perform)

## LLM02: Insecure Output Handling

### Risk

Passing LLM output to an application without validation can lead to secondary attacks such as XSS, SSRF, and command injection.

```bash
# Direct HTML insertion of LLM output (XSS risk)
# Check usage of dangerouslySetInnerHTML, innerHTML, v-html
grep -rn --include='*.{ts,tsx,js,jsx}' \
  -E '(innerHTML|v-html)' \
  . 2>/dev/null | grep -v node_modules

# eval / exec execution of LLM output
grep -rn --include='*.{ts,js,py}' \
  -E '(eval\(|exec\(|Function\(|subprocess).*\b(response|output|result|completion|content)\b' \
  . 2>/dev/null | grep -v node_modules

# Using LLM output as a URL (SSRF risk)
grep -rn --include='*.{ts,js,py}' \
  -E '(fetch|axios|requests\.(get|post)|urllib|http\.get).*\b(response|output|result|content)\b' \
  . 2>/dev/null | grep -v node_modules

# Detect Markdown / HTML rendering
grep -rn --include='*.{ts,tsx,js,jsx}' \
  -E '(react-markdown|remark|rehype|marked|DOMPurify|sanitize-html)' \
  . 2>/dev/null | grep -v node_modules
```

## LLM03: Training Data Poisoning

### Risk

If fine-tuning data or RAG data sources are poisoned, the model's output can be manipulated.

```bash
# Detect fine-tuning data
find . -name '*.jsonl' -o -name 'training_data*' -o -name 'finetune*' \
  -o -name 'dataset*' 2>/dev/null | grep -v node_modules | head -10

# Usage of fine-tuning APIs
grep -rn --include='*.{ts,js,py}' \
  -E '(fine.?tun|FineTuning|create_fine_tuning|training_file)' \
  . 2>/dev/null | grep -v node_modules

# Check for data validation pipelines
grep -rn --include='*.{ts,js,py}' \
  -iE '(data.?valid|schema.?valid|input.?check|data.?clean)' \
  . 2>/dev/null | grep -v node_modules
```

## LLM04: Model Denial of Service

### Risk

Excessive token consumption or repeated requests can cause a spike in API costs or service outages.

```bash
# Check token limit settings
grep -rn --include='*.{ts,js,py}' \
  -E '(max_tokens|maxTokens|max_completion_tokens|token.?limit|max_length)' \
  . 2>/dev/null | grep -v node_modules

# Check rate limiting implementation
grep -rn --include='*.{ts,js,py}' \
  -iE '(rate.?limit|throttle|limiter|RateLimiter|slowDown)' \
  . 2>/dev/null | grep -v node_modules

# Check cost limiting / budget controls
grep -rn --include='*.{ts,js,py}' \
  -iE '(budget|cost.?limit|spending.?limit|usage.?limit|max.?cost)' \
  . 2>/dev/null | grep -v node_modules

# Check input length limits
grep -rn --include='*.{ts,js,py}' \
  -iE '(input.?length|max.?input|content.?length|truncat)' \
  . 2>/dev/null | grep -v node_modules
```

## LLM05: Supply Chain Vulnerabilities

### Risk

Malicious models, tampered AI libraries, or rogue plugins can compromise the entire application.

```bash
# Check AI/ML library dependencies
grep -rn --include='package.json' \
  -E '(openai|@anthropic-ai|langchain|llamaindex|@langchain|ai|@ai-sdk)' \
  . 2>/dev/null | grep -v node_modules

grep -rn --include='requirements*.txt' --include='pyproject.toml' \
  -E '(openai|anthropic|langchain|llama.index|transformers|torch|huggingface)' \
  . 2>/dev/null

# Direct model file downloads (without verification)
grep -rn --include='*.{ts,js,py}' \
  -E '(download.*model|from_pretrained|AutoModel|pipeline\()' \
  . 2>/dev/null | grep -v node_modules

# Pickle / unsafe deserialization
grep -rn --include='*.py' \
  -E '(pickle\.load|torch\.load|joblib\.load|np\.load.*allow_pickle)' \
  . 2>/dev/null | grep -v node_modules
```

## LLM06: Sensitive Information Disclosure

### Risk

PII (Personally Identifiable Information) included in prompts, system prompt leakage, and model memory outputting sensitive data.

```bash
# Potential PII inclusion in prompts
grep -rn --include='*.{ts,js,py}' \
  -iE '(user\.(email|name|phone|address|ssn)|personal|pii|credit.?card).*prompt' \
  . 2>/dev/null | grep -v node_modules

# Check system prompt protection
grep -rn --include='*.{ts,js,py}' \
  -iE '(system.?prompt|system.?message|SYSTEM_PROMPT)' \
  . 2>/dev/null | grep -v node_modules

# Logging of prompts / responses
grep -rn --include='*.{ts,js,py}' \
  -E '(console\.log|logger\.|logging\.).*\b(prompt|message|completion|response)\b' \
  . 2>/dev/null | grep -v node_modules

# PII masking / anonymization implementation
grep -rn --include='*.{ts,js,py}' \
  -iE '(anonymize|mask|redact|scrub|pii.?filter|presidio)' \
  . 2>/dev/null | grep -v node_modules
```

## LLM07: Insecure Plugin Design

### Risk

When an LLM uses external tools / Function Calling, insufficient input validation or excessive permissions create vulnerabilities.

```bash
# Function Calling / Tool Use definitions
grep -rn --include='*.{ts,js,py}' \
  -E '(tools|functions|function_call|tool_choice|tool_use)' \
  . 2>/dev/null | grep -v node_modules | head -30

# Tool execution input validation
grep -rn --include='*.{ts,js,py}' \
  -iE '(tool.?input|function.?arg|parameter.?valid|schema.?valid)' \
  . 2>/dev/null | grep -v node_modules

# LangChain / LlamaIndex tool definitions
grep -rn --include='*.{ts,js,py}' \
  -E '(Tool\(|StructuredTool|BaseTool|FunctionTool|QueryEngineTool)' \
  . 2>/dev/null | grep -v node_modules

# Database / file operations executed by tools
grep -rn --include='*.{ts,js,py}' \
  -E '(tool|agent).*(execute|run|invoke|call)' \
  . 2>/dev/null | grep -v node_modules | head -20
```

## LLM08: Excessive Agency

### Risk

Granting excessive action permissions (data deletion, email sending, payment execution, etc.) to an LLM agent allows unintended operations via hallucinations or prompt injection.

```bash
# Detect usage of agent frameworks
grep -rn --include='*.{ts,js,py}' \
  -E '(AgentExecutor|create_agent|initialize_agent|ReActAgent|AutoGPT|CrewAI)' \
  . 2>/dev/null | grep -v node_modules

# Check for autonomous execution (no human-in-the-loop)
grep -rn --include='*.{ts,js,py}' \
  -iE '(auto.?execute|auto.?run|human.?in.?the.?loop|confirm|approval|require.?human)' \
  . 2>/dev/null | grep -v node_modules

# Dangerous actions (data deletion, email sending, etc.)
grep -rn --include='*.{ts,js,py}' \
  -iE '(delete|remove|drop|send.?email|transfer|payment|deploy)' \
  . 2>/dev/null | grep -v node_modules | \
  grep -iE '(tool|action|function|agent)' | head -20
```

## LLM09: Overreliance

### Risk

Trusting LLM output without verification can result in misinformation from hallucinations or inaccurate code generation being incorporated into the system.

```bash
# Check for fact-checking / verification mechanisms
grep -rn --include='*.{ts,js,py}' \
  -iE '(fact.?check|verify|validate.?output|confidence|certainty|ground.?truth)' \
  . 2>/dev/null | grep -v node_modules

# Direct use of LLM output (without verification)
grep -rn --include='*.{ts,js,py}' \
  -E '(completion|response|output)\.(content|text|message)' \
  . 2>/dev/null | grep -v node_modules | head -20
```

## LLM10: Model Theft

### Risk

Unauthorized use of models through API key leakage, or leakage of proprietary model files.

```bash
# Detect hardcoded API keys
grep -rn --include='*.{ts,js,py}' \
  -E '(OPENAI_API_KEY|ANTHROPIC_API_KEY|api.?key)\s*[:=]\s*['\''"][^'\''"{$]+['\''"]' \
  . 2>/dev/null | grep -v node_modules

# Detect model files
find . -name '*.gguf' -o -name '*.bin' -o -name '*.safetensors' \
  -o -name '*.onnx' -o -name '*.pt' -o -name '*.pth' \
  2>/dev/null | grep -v node_modules | head -10

# Check if model files are tracked by Git
git ls-files | grep -E '\.(gguf|bin|safetensors|onnx|pt|pth)$'

# Check API key management via environment variables
grep -rn --include='*.{ts,js,py}' \
  -E '(process\.env|os\.environ|os\.getenv).*(OPENAI|ANTHROPIC|API_KEY|LLM)' \
  . 2>/dev/null | grep -v node_modules
```

## RAG Security (Retrieval-Augmented Generation)

### Risk

Data source poisoning in the RAG pipeline, insufficient access control on vector DBs, and embedding injection.

```bash
# Detect vector DB usage
grep -rn --include='*.{ts,js,py}' \
  -E '(pinecone|weaviate|qdrant|chroma|milvus|pgvector|faiss|VectorStore)' \
  . 2>/dev/null | grep -v node_modules

# Vector DB access control
grep -rn --include='*.{ts,js,py}' \
  -iE '(api.?key|auth|credential|token).*(pinecone|weaviate|qdrant|chroma)' \
  . 2>/dev/null | grep -v node_modules

# Document loader input validation
grep -rn --include='*.{ts,js,py}' \
  -E '(DocumentLoader|TextLoader|PDFLoader|WebBaseLoader|DirectoryLoader|load_documents)' \
  . 2>/dev/null | grep -v node_modules

# Embedding input sanitization
grep -rn --include='*.{ts,js,py}' \
  -iE '(embed|embedding).*(sanitize|validate|filter|clean)' \
  . 2>/dev/null | grep -v node_modules
```

## MCP Security (Model Context Protocol)

### Risk

If an MCP server allows unverified tool execution, arbitrary system operations become possible via the LLM.

```bash
# Detect MCP server configurations
find . -name 'mcp*.json' -o -name '.mcp*' -o -name 'claude_desktop_config.json' \
  2>/dev/null | head -10

# MCP tool definitions
grep -rn --include='*.{ts,js,py}' \
  -E '(McpServer|Server|tool\(|@mcp\.tool|ListToolsResult)' \
  . 2>/dev/null | grep -v node_modules | head -20

# MCP authentication / authorization settings
grep -rn --include='*.{ts,js,py,json}' \
  -iE '(mcp.*(auth|token|credential|permission)|allowedTools|toolApproval)' \
  . 2>/dev/null | grep -v node_modules
```

## API Security (LLM API)

```bash
# OpenAI / Anthropic SDK usage
grep -rn --include='*.{ts,js,py}' \
  -E '(OpenAI|Anthropic|ChatOpenAI|ChatAnthropic)\(' \
  . 2>/dev/null | grep -v node_modules

# Streaming response handling
grep -rn --include='*.{ts,js,py}' \
  -E '(stream|streaming|createStream|streamText|streamObject)' \
  . 2>/dev/null | grep -v node_modules | head -20

# API endpoint authentication
grep -rn --include='*.{ts,js,py}' \
  -E '(api|route|endpoint).*(chat|completion|generate|embed)' \
  . 2>/dev/null | grep -v node_modules | head -20

# Token count / cost tracking
grep -rn --include='*.{ts,js,py}' \
  -iE '(token.?count|usage|total_tokens|prompt_tokens|completion_tokens|tiktoken|cost.?track)' \
  . 2>/dev/null | grep -v node_modules
```

## OWASP Top 10 for LLM Applications 2025 Quick Reference

| Rank | Category | Key Detection Patterns |
|------|----------|----------------------|
| LLM01 | Prompt Injection | Direct concatenation of user input into prompts, no input filtering |
| LLM02 | Insecure Output Handling | Direct HTML insertion of LLM output, eval execution |
| LLM03 | Training Data Poisoning | Insufficient validation of fine-tuning data |
| LLM04 | Model DoS | No token limits, no rate limiting |
| LLM05 | Supply Chain | Unverified AI libraries, Pickle deserialization |
| LLM06 | Sensitive Information Disclosure | Sending PII in prompts, logging to records |
| LLM07 | Insecure Plugin Design | Insufficient tool input validation, excessive permissions |
| LLM08 | Excessive Agency | No human-in-the-loop, autonomous execution |
| LLM09 | Overreliance | No output verification, lack of fact-checking |
| LLM10 | Model Theft | Hardcoded API keys, exposed model files |

## LLM Security Checklist

### Prompt & Input/Output

- [ ] User input is not directly concatenated into prompts (separated via templates)
- [ ] Input length limits are implemented
- [ ] Prompt injection countermeasures (input filtering / guardrails) are implemented
- [ ] LLM output is not directly executed as HTML / SQL / commands
- [ ] LLM output sanitization and validation are implemented

### Authentication & Authorization

- [ ] LLM API endpoints have authentication implemented
- [ ] API keys are managed via environment variables (not hardcoded)
- [ ] Rate limiting is implemented
- [ ] Token usage caps are configured
- [ ] Cost controls / budget limits are configured

### Data Protection

- [ ] PII included in prompts is masked / anonymized
- [ ] Prompt / response logs do not contain sensitive information
- [ ] System prompt leakage prevention is implemented
- [ ] Vector DB access control is configured

### Tools & Agents

- [ ] Function Calling / Tool Use inputs are validated
- [ ] Tool permissions are minimized
- [ ] Destructive actions (deletion, sending, etc.) have human-in-the-loop implemented
- [ ] MCP server authentication / authorization is configured

### Supply Chain

- [ ] AI/ML libraries are updated to the latest versions
- [ ] Model files are not committed to Git
- [ ] Unsafe deserialization such as Pickle is not used
- [ ] A validation pipeline for fine-tuning data exists
