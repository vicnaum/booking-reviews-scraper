# AI API Pricing Comparison — Large Context Models

**Last updated: February 27, 2026**

---

## Table of Contents

- [Models with 1M+ Context](#models-with-1m-context)
- [Models with 200K–400K Context](#models-with-200k400k-context)
- [Special: 10M Context](#special-10m-context)
- [Groq Hosted Models (Fast Inference)](#groq-hosted-models-fast-inference)
- [Grok 4.20 (Upcoming API)](#grok-420-upcoming-api)
- [Long-Context Surcharge Summary](#long-context-surcharge-summary)
- [Batch API Discounts](#batch-api-discounts)
- [Prompt Caching Discounts](#prompt-caching-discounts)
- [Key Takeaways](#key-takeaways)
- [Pricing Page Links](#pricing-page-links)

---

## Models with 1M+ Context

| Provider | Model | Context | Input $/1M | Output $/1M | >200k Surcharge? |
|---|---|---|---|---|---|
| **xAI** | Grok 4.1 Fast | **2M** | $0.20 | $0.50 | No |
| **xAI** | Grok 4 Fast | **2M** | $0.20 | $0.50 | No |
| **Google** | Gemini 2.0 Flash Lite | 1M | $0.075 | $0.30 | No |
| **Alibaba** | Qwen 3.5 Flash | 1M | $0.10 | $0.40 | No |
| **Google** | Gemini 2.0 Flash | 1M | $0.10 | $0.40 | No |
| **Google** | Gemini 2.5 Flash-Lite | 1M | $0.10 | $0.40 | No |
| **OpenAI** | GPT-4.1 Nano | 1M | $0.10 | $0.40 | No |
| **Google** | Gemini 2.5 Flash | 1M | $0.30 | $2.50 | No |
| **OpenAI** | GPT-4.1 Mini | 1M | $0.40 | $1.60 | No |
| **Google** | Gemini 3 Flash | 1M | $0.50 | $3.00 | No |
| **Google** | Gemini 2.5 Pro | 1M | $1.25 | $10.00 | **Yes: 2x** ($2.50/$15.00) |
| **OpenAI** | GPT-4.1 | 1M | $2.00 | $8.00 | No |
| **Google** | Gemini 3.1 Pro | 1M | $2.00 | $12.00 | **Yes: 2x** ($4.00/$18.00) |
| **Anthropic** | Claude Sonnet 4.6 | 1M | $3.00 | $15.00 | **Yes: 2x** ($6.00/$22.50) |
| **Anthropic** | Claude Opus 4.6 | 1M | $5.00 | $25.00 | **Yes: 2x** ($10.00/$37.50) |

---

## Models with 200K–400K Context

| Provider | Model | Context | Input $/1M | Output $/1M | Notes |
|---|---|---|---|---|---|
| **OpenAI** | GPT-5 Nano | 400K | $0.05 | $0.40 | Cheapest OpenAI model |
| **Mistral** | Ministral-14B | 262K | $0.20 | $0.20 | Cheapest 262K option |
| **OpenAI** | GPT-5 Mini | 400K | $0.25 | $2.00 | 128K max output |
| **Mistral** | Codestral | 256K | $0.30 | $0.90 | Code-specialized |
| **xAI** | Grok 3 Mini | 131K | $0.30 | $0.50 | Reasoning model |
| **Mistral** | Mistral Large 3 | 262K | $0.50 | $1.50 | Flagship, open-source |
| **Mistral** | Devstral 2 | 262K | $0.50 | $1.50 | Code agent |
| **Anthropic** | Claude Haiku 4.5 | 200K | $1.00 | $5.00 | No 1M option |
| **OpenAI** | o4-mini | 200K | $1.10 | $4.40 | Reasoning model |
| **OpenAI** | GPT-5 | 400K | $1.25 | $10.00 | 128K max output |
| **OpenAI** | o3 | 200K | $2.00 | $8.00 | Reasoning model |
| **Cohere** | Command A | 256K | $2.50 | $10.00 | Enterprise-focused |
| **xAI** | Grok 4 | 256K | $3.00 | $15.00 | xAI flagship |

---

## Special: 10M Context

| Provider | Model | Context | Input $/1M | Output $/1M | Notes |
|---|---|---|---|---|---|
| **Meta** | Llama 4 Scout (hosted) | **10M** | ~$0.18 | ~$0.63 | Open-source, prices vary by host |

---

## Groq Hosted Models (Fast Inference)

Groq hosts open-source models on custom LPU hardware for ultra-fast inference. Max context: 131K–262K (no 1M options).

| Model | Developer | Input $/1M | Output $/1M | Context | Speed |
|---|---|---|---|---|---|
| **Llama 3.1 8B** | Meta | $0.05 | $0.08 | 131K | ~840 tps |
| **GPT-OSS 20B** | OpenAI | $0.075 | $0.30 | 131K | ~1,000 tps |
| **Llama 4 Scout** (17Bx16E) | Meta | $0.11 | $0.34 | 131K | ~750 tps |
| **GPT-OSS 120B** | OpenAI | $0.15 | $0.60 | 131K | ~500 tps |
| **Llama 4 Maverick** (17Bx128E) | Meta | $0.20 | $0.60 | 131K | ~600 tps |
| **Qwen3-32B** | Alibaba | $0.29 | $0.59 | 131K | ~660 tps |
| **Llama 3.3 70B** | Meta | $0.59 | $0.79 | 131K | ~394 tps |
| **Kimi K2** (1T MoE) | Moonshot AI | $1.00 | $3.00 | **262K** | ~200 tps |

Groq discounts: Batch API 50% off, Prompt caching 50% off input (GPT-OSS & Kimi K2). No long-context surcharges.

---

## Grok 4.20 (Upcoming API)

**Status: Public beta since Feb 17, 2026 — API not yet available (expected March 2026)**

- 4-agent collaboration system (~3T parameter MoE)
- 256K standard context, up to 2M in agentic modes
- ~65% hallucination reduction vs Grok 4.1
- **Grok 4.20 Heavy** variant uses 16 agents
- Consumer access: SuperGrok ($30/mo) or X Premium+ ($40/mo)
- API pricing TBD

---

## Long-Context Surcharge Summary

| Provider | Threshold | Effect |
|---|---|---|
| **Anthropic** | >200K input tokens | **2x on ALL tokens** (input + output) |
| **Google** | >200K input tokens (Pro models only) | **2x on ALL tokens**; Flash models = no surcharge |
| **OpenAI** | None | Flat pricing at all context lengths |
| **xAI** | None | Flat pricing at all context lengths |
| **Mistral** | Unconfirmed | Possible tiers, not officially documented |

---

## Batch API Discounts

All major providers offer **50% off** via async Batch APIs (typically 24h processing window).

| Provider | Batch Discount | Notes |
|---|---|---|
| Anthropic | 50% off | Stacks with long-context pricing |
| OpenAI | 50% off | All models |
| Google | 50% off | All paid models |
| xAI | 50% off | All models |
| Groq | 50% off | Select models, 24h–7d window |

---

## Prompt Caching Discounts

| Provider | Cache Hit Discount | Cache Write Cost | Notes |
|---|---|---|---|
| **Anthropic** | 90% off input | 1.25x (5-min) or 2x (1-hr) | Stacks with long-context |
| **OpenAI** | 50–90% off input | Free (automatic) | GPT-5: 90%, GPT-4.1: 75%, GPT-4o: 50% |
| **Google** | ~90% off input | ~10% of input price + storage/hr | Pro: $4.50/1M/hr, Flash: $1.00/1M/hr |
| **xAI** | 75% off input | Free (automatic) | Grok 4 and newer |
| **Groq** | 50% off input | Free | GPT-OSS & Kimi K2 only |

---

## Key Takeaways

1. **Cheapest 1M context**: Gemini 2.0 Flash Lite ($0.075/$0.30) or Qwen 3.5 Flash ($0.10/$0.40)
2. **Best value with no surcharge**: xAI Grok 4.1 Fast — $0.20/$0.50 with **2M context**
3. **Best "smart" 1M model**: GPT-4.1 at $2.00/$8.00 (no surcharge) vs Gemini 2.5 Pro at $1.25/$10.00 (but 2x after 200K)
4. **Anthropic is most expensive** for long context — Sonnet 4.6 at >200K costs $6/$22.50, roughly 3x GPT-4.1
5. **Largest context**: Llama 4 Scout at 10M tokens (~$0.18/$0.63 via hosting providers)
6. **Fastest inference**: Groq GPT-OSS 20B at 1,000 tps for $0.075/$0.30 (but 131K max context)
7. **Upcoming**: Grok 4.20 API expected March 2026 with 4-agent collaboration

---

## Pricing Page Links

| Provider | Official Pricing Page |
|---|---|
| **Anthropic** | https://docs.anthropic.com/en/docs/about-claude/pricing |
| **OpenAI** | https://openai.com/api/pricing/ |
| **Google Gemini** | https://ai.google.dev/gemini-api/docs/pricing |
| **xAI (Grok)** | https://docs.x.ai/developers/models |
| **Mistral** | https://mistral.ai/pricing |
| **DeepSeek** | https://api-docs.deepseek.com/quick_start/pricing |
| **Cohere** | https://cohere.com/pricing |
| **Alibaba (Qwen)** | https://www.alibabacloud.com/help/en/model-studio/model-pricing |
| **Groq** | https://groq.com/pricing |
| **Meta Llama** | https://www.llama.com/models/llama-4/ |
