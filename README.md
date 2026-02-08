# SEO-GEO Audit Tool by Pomelo Marketing

Narzędzie do audytu widoczności strony w wyszukiwarkach i AI (ChatGPT, Gemini).

Analizuje stronę pod kątem: PageSpeed, mobile-friendliness, HTTPS, Schema Markup oraz widoczności w ChatGPT i Google Gemini. Wyniki prezentowane są w formie interaktywnego raportu z oszacowaniem strat biznesowych.

## Stack

- **Frontend:** Vanilla JS, Tailwind CSS (CDN), Chart.js
- **Backend:** Vercel Serverless Functions (`api/analyze.js`)
- **Email:** Resend API

## Zmienne środowiskowe (Vercel)

| Zmienna | Opis |
|---|---|
| `GOOGLE_API_KEY` | Google PageSpeed Insights API |
| `OPENAI_API_KEY` | OpenAI API (ChatGPT visibility check) |
| `GEMINI_API_KEY` | Google Gemini API |
| `RESEND_API_KEY` | Resend (wysyłka emaili z wynikami) |

## Deploy

Auto-deploy z GitHub na Vercel. Strona dostępna pod: `seo.pomelo.marketing`

## Kontakt

pomelomarketingandsoft@gmail.com
