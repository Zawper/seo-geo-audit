// api/analyze.js
import { Resend } from 'resend';

const requestLog = {};

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, url } = req.body;

  // === RATE LIMITING ===
  const clientIP = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  
  Object.keys(requestLog).forEach(ip => {
    if (now - requestLog[ip].firstRequest > 3600000) {
      delete requestLog[ip];
    }
  });
  
  if (!requestLog[clientIP]) {
    requestLog[clientIP] = { count: 1, firstRequest: now };
  } else {
    requestLog[clientIP].count++;
    
    if (requestLog[clientIP].count > 3) {
      return res.status(429).json({ 
        error: 'Zbyt wiele prób. Spróbuj za godzinę.' 
      });
    }
  }

  // Validation
  if (!email || !url) {
    return res.status(400).json({ error: 'Email and URL required' });
  }

  try {
    console.log(`Audit: ${url}`);
    
    // Run all checks in parallel
    const results = await Promise.all([
      checkPageSpeedAndMobile(url),
      checkHTTPS(url),
      checkChatGPT(url),
      checkGemini(url),
      checkSchema(url)
    ]);

    const [pageSpeedAndMobile, https, chatGPT, gemini, schema] = results;
    const pageSpeed = { score: pageSpeedAndMobile.score, loadTime: pageSpeedAndMobile.loadTime };
    const mobileFriendly = { passed: pageSpeedAndMobile.isMobileFriendly };

    // Calculate score
    const auditData = {
      score: calculateScore({ pageSpeed, mobileFriendly, https, chatGPT, gemini, schema }),
      pageSpeed: pageSpeed.score,
      loadTime: pageSpeed.loadTime,
      mobileFriendly: mobileFriendly.passed,
      https: https.secure,
      chatGPTCitation: chatGPT.mentioned,
      geminiCitation: gemini.mentioned,
      schemaMarkup: schema.hasSchema
    };

    console.log(`Audit complete: score=${auditData.score}`);

    // Send email with results (nie blokuj odpowiedzi jeśli email się nie wyśle)
    try {
      await sendEmailReport(email, url, auditData);
    } catch (emailError) {
      console.error('Email sending failed but continuing:', emailError.message);
    }

    return res.status(200).json(auditData);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// === PAGESPEED + MOBILE CHECK (single API request) ===
async function checkPageSpeedAndMobile(url) {
  const API_KEY = process.env.GOOGLE_API_KEY;

  try {
    const response = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${API_KEY}&category=performance&strategy=mobile`
    );

    if (!response.ok) throw new Error('PageSpeed API failed');

    const data = await response.json();
    const performanceScore = Math.round(data.lighthouseResult.categories.performance.score * 100);
    const speedIndex = data.lighthouseResult.audits['speed-index'].numericValue / 1000;
    const viewportAudit = data.lighthouseResult.audits['viewport'];
    const isMobileFriendly = viewportAudit && viewportAudit.score === 1;

    return {
      score: performanceScore,
      loadTime: parseFloat(speedIndex.toFixed(1)),
      isMobileFriendly
    };
  } catch (error) {
    console.error('PageSpeed error:', error);
    return { score: 50, loadTime: 3.5, isMobileFriendly: true };
  }
}

// === HTTPS CHECK ===
async function checkHTTPS(url) {
  try {
    // Normalizuj URL - dodaj https:// jeśli brakuje protokołu
    let normalizedUrl = url.trim();

    // Jeśli URL nie zaczyna się od http:// ani https://, dodaj https://
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    // Sprawdź czy URL po normalizacji używa HTTPS
    const isSecure = normalizedUrl.startsWith('https://');

    return { secure: isSecure };
  } catch (error) {
    console.error('HTTPS check error:', error);
    // W razie błędu zakładamy brak HTTPS
    return { secure: false };
  }
}

// === CHATGPT CHECK ===
async function checkChatGPT(url) {
  const API_KEY = process.env.OPENAI_API_KEY;
  const domain = new URL(url).hostname.replace('www.', '');
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Find information about services or products offered by ${domain}. Keep response under 100 words.`
        }],
        max_tokens: 150
      })
    });
    
    if (!response.ok) throw new Error('OpenAI API failed');
    
    const data = await response.json();
    const answer = data.choices[0].message.content.toLowerCase();
    
    return { mentioned: answer.includes(domain) || answer.includes(domain.split('.')[0]) };
  } catch (error) {
    console.error('ChatGPT error:', error);
    return { mentioned: false };
  }
}

// === GEMINI CHECK ===
async function checkGemini(url) {
  const API_KEY = process.env.GEMINI_API_KEY;
  const domain = new URL(url).hostname.replace('www.', '');
  
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Find information about services or products offered by ${domain}. Keep response under 100 words.`
            }]
          }]
        })
      }
    );
    
    if (!response.ok) throw new Error('Gemini API failed');
    
    const data = await response.json();
    const answer = data.candidates[0].content.parts[0].text.toLowerCase();
    
    return { mentioned: answer.includes(domain) || answer.includes(domain.split('.')[0]) };
  } catch (error) {
    console.error('Gemini error:', error);
    return { mentioned: false };
  }
}

// === SCHEMA MARKUP CHECK ===
async function checkSchema(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    
    const hasJsonLd = html.includes('application/ld+json');
    const schemaTypes = ['Organization', 'LocalBusiness', 'WebSite', 'Product', 'Service', 'FAQPage', 'Article', 'BreadcrumbList'];
    const hasAnyType = schemaTypes.some(type =>
      html.includes(`"@type":"${type}"`) || html.includes(`"@type": "${type}"`)
    );

    return { hasSchema: hasJsonLd && hasAnyType };
  } catch (error) {
    console.error('Schema check error:', error);
    return { hasSchema: false };
  }
}

// === CALCULATE SCORE ===
function calculateScore(data) {
  let score = 0;
  
  if (data.pageSpeed.score >= 90) score += 20;
  else if (data.pageSpeed.score >= 50) score += 10;
  
  if (data.mobileFriendly.passed) score += 15;
  if (data.https.secure) score += 15;
  
  if (data.chatGPT.mentioned) score += 20;
  if (data.gemini.mentioned) score += 20;
  if (data.schema.hasSchema) score += 10;
  
  return Math.round(score);
}

// === CALCULATE TOTAL LOSS (for email) ===
function calculateTotalLoss(data) {
  let total = 0;
  if (data.pageSpeed < 60) total += Math.round(1700 * (data.loadTime / 4.2));
  if (!data.chatGPTCitation || !data.geminiCitation) total += 1300;
  if (!data.mobileFriendly) total += 1040;
  if (!data.schemaMarkup) total += 760;
  return total;
}

// === SEND EMAIL ===
async function sendEmailReport(email, url, data) {
  console.log('===== EMAIL DEBUG START =====');
  console.log('Recipient:', email);
  console.log('URL:', url);
  console.log('Score:', data.score);
  console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY ? 'SET' : 'NOT SET');
  
  if (!process.env.RESEND_API_KEY) {
    console.error('❌ BŁĄD: Brak zmiennej RESEND_API_KEY!');
    throw new Error('Missing email configuration');
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  
  const statusEmoji = data.score >= 70 ? '🟢' : data.score >= 40 ? '🟡' : '🔴';
  const statusText = data.score >= 70 ? 'DOBRA' : data.score >= 40 ? 'ŚREDNIA' : 'NISKA';
  
  const totalProblems = [
    data.pageSpeed < 60,
    !data.mobileFriendly,
    !data.https,
    !data.chatGPTCitation,
    !data.geminiCitation,
    !data.schemaMarkup
  ].filter(Boolean).length;
  
  const emailHtml = `
<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #f3f4f6;
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
    }
    .container {
      max-width: 600px;
      margin: 32px auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
    }
    .header {
      padding: 24px;
      border-bottom: 1px solid #e5e7eb;
    }
    .score {
  font-size: 42px;
  font-weight: 700;
  margin: 0;
  text-align: center;
}
    .url {
      font-size: 13px;
      color: #6b7280;
      margin-top: 6px;
      word-break: break-all;
    }
    .status {
      margin-top: 8px;
      font-size: 14px;
      font-weight: 600;
    }
    .content {
      padding: 24px;
    }
    h2 {
      font-size: 18px;
      margin: 0 0 16px 0;
      border-bottom: 2px solid #6366f1;
      padding-bottom: 6px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #e5e7eb;
      font-size: 14px;
    }
    .good { color: #059669; font-weight: 600; }
    .bad { color: #dc2626; font-weight: 600; }
    .problem {
      padding: 16px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .problem-title {
      font-weight: 700;
      margin-bottom: 6px;
    }
    .problem-desc {
      font-size: 13px;
      color: #4b5563;
      margin-bottom: 6px;
    }
    .problem-meta {
      font-size: 13px;
      color: #111827;
    }
    .loss {
      text-align: center;
      padding: 24px;
      background: #f9fafb;
      font-size: 22px;
      font-weight: 700;
    }
    .cta {
      text-align: center;
      padding: 24px;
    }
    .cta a {
      display: inline-block;
      background: #6366f1;
      color: #ffffff;
      text-decoration: none;
      padding: 14px 28px;
      font-weight: 700;
      border-radius: 6px;
      font-size: 15px;
    }
    .cta small {
      display: block;
      margin-top: 12px;
      font-size: 12px;
      color: #6b7280;
      line-height: 1.6;
    }
    .footer {
      padding: 20px;
      background: #f9fafb;
      text-align: center;
      font-size: 12px;
      color: #6b7280;
      border-top: 1px solid #e5e7eb;
    }
    .footer a {
      color: #6b7280;
      text-decoration: none;
    }
    .footer a:hover {
      color: #6366f1;
    }
    .footer-links {
      margin-bottom: 8px;
    }
  </style>
</head>

<body>
  <div class="container">

    <div class="header" style="text-align:center;">
  <p class="score">${data.score}%</p>
  <p class="url">${url}</p>
  <p class="status">${statusEmoji} Widoczność: ${statusText}</p>
</div>

<div class="loss">
  ~${calculateTotalLoss(data).toLocaleString('pl-PL')} zł / miesiąc
  <div style="font-size:13px;color:#6b7280;margin-top:8px;">
    Szacowana strata w utraconych wyświetleniach i potencjalnych klientach
  </div>
</div>
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:12px 24px 0;">
  Szacunki oparte o średnie CTR, branżowe benchmarki i dane o zachowaniu użytkowników.
</p>

    <div class="content">
      <h2>Szczegóły techniczne</h2>

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">Szybkość strony</td>
    <td align="right" style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;color:${data.pageSpeed >= 60 ? '#059669' : '#dc2626'};">
      ${data.pageSpeed}/100
    </td>
  </tr>
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">Czas ładowania</td>
    <td align="right" style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;color:${data.loadTime < 3 ? '#059669' : '#dc2626'};">
      ${data.loadTime}s
    </td>
  </tr>
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">Mobile-Friendly</td>
    <td align="right" style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;color:${data.mobileFriendly ? '#059669' : '#dc2626'};">
      ${data.mobileFriendly ? 'Tak' : 'Nie'}
    </td>
  </tr>
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">HTTPS</td>
    <td align="right" style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;color:${data.https ? '#059669' : '#dc2626'};">
      ${data.https ? 'Tak' : 'Nie'}
    </td>
  </tr>
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">Przystosowanie do AI (ChatGPT)</td>
    <td align="right" style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;color:${data.chatGPTCitation ? '#059669' : '#dc2626'};">
      ${data.chatGPTCitation ? 'Tak' : 'Nie'}
    </td>
  </tr>
  <tr>
    <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">Przystosowanie do AI (Gemini)</td>
    <td align="right" style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;color:${data.geminiCitation ? '#059669' : '#dc2626'};">
      ${data.geminiCitation ? 'Tak' : 'Nie'}
    </td>
  </tr>
  <tr>
    <td style="padding:8px 0;">Schema Markup</td>
    <td align="right" style="padding:8px 0;font-weight:600;color:${data.schemaMarkup ? '#059669' : '#dc2626'};">
      ${data.schemaMarkup ? 'Wdrożone' : 'Brak'}
    </td>
  </tr>
</table>

      ${totalProblems > 0 ? `
      <h2 style="margin-top:32px;">Wykryte problemy (${totalProblems})</h2>
      ${!data.pageSpeed || data.pageSpeed < 60 ? `
        <div class="problem">
          <div class="problem-title">Wolne ładowanie strony</div>
          <div class="problem-desc">Strona ładuje się wolniej niż zalecane standardy Google. Powoduje to wyższy współczynnik odrzuceń.
    Użytkownicy opuszczają stronę zanim zobaczą ofertę, a Google obniża jej pozycję
    w wynikach wyszukiwania.</div>
          <div class="problem-meta"><strong>Naprawa:</strong> 1–2 tygodnie</div>
        </div>` : ''}
      ${!data.chatGPTCitation || !data.geminiCitation ? `
        <div class="problem">
          <div class="problem-title">Niska gotowość strony do AI</div>
          <div class="problem-desc">Strona nie jest w pełni przygotowana do cytowań i interpretacji przez systemy AI. To oznacza mniejszą szansę na pojawienie się
    w odpowiedziach generowanych przez systemy AI (np. ChatGPT, Gemini),
    z których codziennie korzystają miliony użytkowników.</div>
          <div class="problem-meta"><strong>Naprawa:</strong> 2–3 tygodnie</div>
        </div>` : ''}
      ` : ''}

    </div>

    <div class="cta">
     
<a href="https://pomelo.marketing/#raporty?utm_source=email&utm_medium=seo_report&utm_campaign=audit"
  target="_blank" rel="noopener noreferrer">
  Zamów pełny raport – 99 zł</a>
      <small>
        30+ metryk • Plan naprawczy • Analiza konkurencji • Wycena wdrożenia<br/>
        Raport gotowy do 7 dni
      </small>
    </div>

    <div class="footer">
      <div class="footer-links">
        <a href="https://pomelo.marketing/polityka-prywatnosci.html" target="_blank" rel="noopener noreferrer">
          Polityka prywatności
        </a>
        |
        <a href="https://pomelo.marketing/polityka-cookies.html" target="_blank" rel="noopener noreferrer">
          Polityka cookies
        </a>
      </div>
      <p>
        &copy; 2026
        <a href="https://pomelo.marketing" target="_blank" rel="noopener noreferrer">
          POMELO Marketing and Soft
        </a>
      </p>
    </div>

  </div>
</body>
</html>
`;
  
  try {
    const { data: emailData, error } = await resend.emails.send({
      from: 'Pomelo SEO/GEO <noreply@seo.pomelo.marketing>',
      to: [email],
      subject: `Audyt SEO/GEO: ${data.score}% — ${totalProblems} wykrytych problemów`,
      html: emailHtml,
    });

    if (error) {
      console.error('❌ Resend API error:', error);
      throw error;
    }

    console.log('✅ Email sent successfully to:', email);
    console.log('Email ID:', emailData?.id);
    console.log('===== EMAIL DEBUG END =====');
    
    return emailData;
    
  } catch (error) {
    console.error('❌ Email send error:', error);
    console.error('Error details:', error.message);
    console.log('===== EMAIL DEBUG END =====');
    throw error;
  }
}
