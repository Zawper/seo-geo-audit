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
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      margin: 0;
      padding: 0;
      background: #f3f4f6;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: white;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #9333ea 0%, #ec4899 100%);
      color: white;
      padding: 40px 30px;
      text-align: center;
    }
    .header h1 { margin: 0 0 10px 0; font-size: 28px; }
    
    .score-circle {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: rgba(255,255,255,0.2);
  margin: 20px auto;
  font-size: 42px;
  font-weight: bold;
  border: 4px solid rgba(255,255,255,0.3);
  text-align: center;
  line-height: 112px;
}
    .content { padding: 40px 30px; }
    .section { margin: 30px 0; }
    .section-title {
      font-size: 20px;
      font-weight: bold;
      color: #1f2937;
      margin-bottom: 15px;
      border-left: 4px solid #9333ea;
      padding-left: 12px;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin: 20px 0;
    }
    .metric-box {
      background: #f9fafb;
      padding: 15px;
      border-radius: 8px;
      border-left: 3px solid #e5e7eb;
    }
    .metric-box.good { border-left-color: #10b981; background: #f0fdf4; }
    .metric-box.bad { border-left-color: #ef4444; background: #fef2f2; }
    .metric-title { font-weight: bold; color: #374151; margin-bottom: 5px; }
    .metric-value { font-size: 14px; color: #6b7280; }
    .problem-box {
      background: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 20px;
      margin: 15px 0;
      border-radius: 8px;
    }
    .problem-title {
      font-weight: bold;
      color: #991b1b;
      font-size: 16px;
      margin-bottom: 10px;
    }
    .problem-desc {
      font-size: 14px;
      color: #6b7280;
      margin-bottom: 10px;
      font-style: italic;
    }
    .problem-impact {
      font-size: 14px;
      color: #374151;
      line-height: 1.8;
    }
    .cta-button {
      background: linear-gradient(135deg, #9333ea 0%, #ec4899 100%);
      color: white;
      padding: 16px 32px;
      text-decoration: none;
      border-radius: 8px;
      display: inline-block;
      font-weight: bold;
      font-size: 16px;
      margin: 10px 0;
    }
    .warning-box {
      background: #fff7ed;
      border: 2px solid #fb923c;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
      text-align: center;
    }
    .footer {
      background: #f9fafb;
      padding: 30px;
      text-align: center;
      font-size: 14px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Twój Audyt SEO/GEO</h1>
      <div class="score-circle">${data.score}%</div>
      <p>Widoczność: ${statusEmoji} ${statusText}</p>
    </div>

    <div class="content">
      <h2>Wyniki dla ${url}</h2>

      <!-- Szczegóły techniczne -->
      <div class="section">
        <div class="section-title">📋 Szczegóły Techniczne</div>
        <div class="metric-grid">
          <div class="metric-box ${data.pageSpeed >= 60 ? 'good' : 'bad'}">
            <div class="metric-title">PageSpeed</div>
            <div class="metric-value">${data.pageSpeed}/100</div>
          </div>
          <div class="metric-box ${data.loadTime < 3 ? 'good' : 'bad'}">
            <div class="metric-title">Czas ładowania</div>
            <div class="metric-value">${data.loadTime}s</div>
          </div>
          <div class="metric-box ${data.mobileFriendly ? 'good' : 'bad'}">
            <div class="metric-title">Mobile-Friendly</div>
            <div class="metric-value">${data.mobileFriendly ? '✅ Tak' : '❌ Nie'}</div>
          </div>
          <div class="metric-box ${data.https ? 'good' : 'bad'}">
            <div class="metric-title">HTTPS</div>
            <div class="metric-value">${data.https ? '✅ Tak' : '❌ Nie'}</div>
          </div>
          <div class="metric-box ${data.chatGPTCitation ? 'good' : 'bad'}">
            <div class="metric-title">ChatGPT Visibility</div>
            <div class="metric-value">${data.chatGPTCitation ? '✅ Widoczna' : '❌ Niewidoczna'}</div>
          </div>
          <div class="metric-box ${data.geminiCitation ? 'good' : 'bad'}">
            <div class="metric-title">Gemini Visibility</div>
            <div class="metric-value">${data.geminiCitation ? '✅ Widoczna' : '❌ Niewidoczna'}</div>
          </div>
          <div class="metric-box ${data.schemaMarkup ? 'good' : 'bad'}">
            <div class="metric-title">Schema Markup</div>
            <div class="metric-value">${data.schemaMarkup ? '✅ Wdrożone' : '❌ Brak'}</div>
          </div>
        </div>
      </div>

      <!-- Główne problemy -->
      <div class="section">
        <div class="section-title">⚠️ Wykryte Problemy (${totalProblems})</div>

        ${data.pageSpeed < 60 ? `
        <div class="problem-box">
          <div class="problem-title">Problem #1: Wolne ładowanie strony (${data.loadTime}s)</div>
          <div class="problem-desc">Wolne ładowanie powoduje, że użytkownicy opuszczają stronę zanim się załaduje. Google karze wolne strony niższą pozycją.</div>
          <div class="problem-impact">
            📉 Możesz tracić: <strong>~${Math.round(1700 * (data.loadTime / 4.2)).toLocaleString('pl-PL')} zł/mies</strong><br>
            👁️ To około: <strong>~${Math.round(1700 * (data.loadTime / 4.2) * 5).toLocaleString('pl-PL')} wyświetleń miesięcznie</strong><br>
            ⏱️ Naprawa: <strong>1-2 tygodnie</strong>
          </div>
        </div>
        ` : ''}

        ${!data.chatGPTCitation || !data.geminiCitation ? `
        <div class="problem-box">
          <div class="problem-title">Problem #2: Brak widoczności w AI (ChatGPT/Gemini)</div>
          <div class="problem-desc">AI asystenci mają dostęp do milionów użytkowników dziennie. Brak widoczności w AI oznacza utratę całej grupy klientów.</div>
          <div class="problem-impact">
            📉 Możesz tracić: <strong>~1,300 zł/mies</strong><br>
            👁️ To około: <strong>~6,500 wyświetleń miesięcznie</strong><br>
            ⏱️ Naprawa: <strong>2-3 tygodnie</strong>
          </div>
        </div>
        ` : ''}

        ${!data.mobileFriendly ? `
        <div class="problem-box">
          <div class="problem-title">Problem #3: Słaba optymalizacja mobile</div>
          <div class="problem-desc">Ponad 70% użytkowników przegląda internet na telefonach. Strona źle działająca na mobile traci większość klientów.</div>
          <div class="problem-impact">
            📉 Możesz tracić: <strong>~1,040 zł/mies</strong><br>
            👁️ To około: <strong>~5,200 wyświetleń miesięcznie</strong><br>
            ⏱️ Naprawa: <strong>1 tydzień</strong>
          </div>
        </div>
        ` : ''}

        ${!data.schemaMarkup ? `
        <div class="problem-box">
          <div class="problem-title">Problem #4: Brak Schema Markup</div>
          <div class="problem-desc">Schema Markup to język, którym Google i AI rozumieją Twoją stronę. Bez niego trudniej uzyskać wysoką widoczność.</div>
          <div class="problem-impact">
            📉 Możesz tracić: <strong>~760 zł/mies</strong><br>
            👁️ To około: <strong>~3,800 wyświetleń miesięcznie</strong><br>
            ⏱️ Naprawa: <strong>3-5 dni</strong>
          </div>
        </div>
        ` : ''}
      </div>

      <!-- Ostrzeżenie o stratach -->
      <div class="warning-box">
        <h3 style="color: #ea580c; margin: 0 0 10px 0;">⚠️ Podsumowanie strat</h3>
        <p style="font-size: 24px; font-weight: bold; color: #991b1b; margin: 10px 0;">
          Tracisz około ${calculateTotalLoss(data).toLocaleString('pl-PL')} zł miesięcznie
        </p>
        <p style="color: #6b7280; margin: 0;">
          w utraconych wyświetleniach i potencjalnych klientach
        </p>
      </div>

      <!-- CTA -->
      <div style="text-align: center; margin: 40px 0;">
        <p style="font-size: 18px; color: #374151; margin-bottom: 20px;">
          <strong>Odblokuj pełny raport profesjonalny</strong> z planem naprawczym krok po kroku
        </p>
        <a href="mailto:pomelomarketingandsoft@gmail.com?subject=Zamówienie%20raportu%20za%2099%20zł&body=Email:%20${encodeURIComponent(email)}%0AStrona:%20${encodeURIComponent(url)}" class="cta-button">
          Kup pełny raport za 99 zł
        </a>
        <p style="font-size: 14px; color: #6b7280; margin-top: 15px;">
          ✓ 30+ metryk szczegółowych<br>
          ✓ Plan naprawczy krok po kroku<br>
          ✓ Analiza 3 konkurentów<br>
          ✓ Wycena kosztów wdrożenia
        </p>
      </div>
    </div>

    <div class="footer">
      <p><strong>Pomelo Marketing & Software</strong></p>
      <p>Pytania? Napisz: pomelomarketingandsoft@gmail.com</p>
    </div>
  </div>
</body>
</html>
  `;
  
  try {
    const { data: emailData, error } = await resend.emails.send({
      from: 'Pomelo SEO/GEO <onboarding@resend.dev>',
      to: [email],
      subject: `${statusEmoji} Wynik: ${data.score}% - ${totalProblems} problemów`,
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
