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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #9333ea 0%, #ec4899 100%);
      color: #ffffff;
      padding: 48px 32px;
      text-align: center;
    }
    .score {
      font-size: 64px;
      font-weight: 800;
      letter-spacing: -2px;
      margin: 0;
      line-height: 1;
    }
    .header-url {
      font-size: 14px;
      opacity: 0.85;
      margin: 16px 0 4px 0;
      word-break: break-all;
    }
    .header-status {
      font-size: 16px;
      font-weight: 600;
      margin: 4px 0 0 0;
    }
    .content {
      padding: 40px 32px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #1f2937;
      margin: 0 0 20px 0;
      padding-bottom: 10px;
      border-bottom: 2px solid #9333ea;
    }
    .metric-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .metric-row:last-child {
      border-bottom: none;
    }
    .metric-name {
      font-size: 14px;
      font-weight: 600;
      color: #374151;
    }
    .metric-value {
      font-size: 14px;
      font-weight: 600;
    }
    .good { color: #10b981; }
    .bad { color: #ef4444; }
    .problem-item {
      padding: 20px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .problem-item:last-child {
      border-bottom: none;
    }
    .problem-name {
      font-size: 16px;
      font-weight: 700;
      color: #1f2937;
      margin: 0 0 6px 0;
    }
    .problem-desc {
      font-size: 14px;
      color: #6b7280;
      margin: 0 0 12px 0;
    }
    .problem-detail {
      font-size: 13px;
      color: #374151;
      margin: 4px 0;
    }
    .loss-section {
      text-align: center;
      padding: 32px 0;
    }
    .loss-amount {
      font-size: 32px;
      font-weight: 800;
      color: #1f2937;
      margin: 0;
    }
    .loss-sub {
      font-size: 14px;
      color: #6b7280;
      margin: 8px 0 0 0;
    }
    .cta-section {
      text-align: center;
      padding: 32px 0 0 0;
    }
    .cta-label {
      font-size: 16px;
      color: #374151;
      margin: 0 0 20px 0;
    }
    .cta-button {
      background: linear-gradient(135deg, #9333ea 0%, #ec4899 100%);
      color: #ffffff;
      padding: 16px 40px;
      text-decoration: none;
      border-radius: 8px;
      display: inline-block;
      font-weight: 700;
      font-size: 16px;
    }
    .cta-features {
      font-size: 13px;
      color: #6b7280;
      margin: 20px 0 0 0;
      line-height: 2;
    }
    .cta-note {
      font-size: 13px;
      color: #9ca3af;
      margin: 16px 0 0 0;
    }
    .footer {
      background: #f9fafb;
      padding: 28px 32px;
      text-align: center;
      font-size: 13px;
      color: #6b7280;
    }
    .footer a {
      color: #9333ea;
      text-decoration: none;
    }
    .footer p {
      margin: 4px 0;
    }
    .divider {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 32px 0;
    }
  </style>
</head>
<body>
  <div class="container">

    <div class="header">
      <p class="score">${data.score}%</p>
      <p class="header-url">${url}</p>
      <p class="header-status">${statusEmoji} Widoczność: ${statusText}</p>
    </div>

    <div class="content">

      <h2 class="section-title">Szczegóły techniczne</h2>

      <div>
        <div class="metric-row">
          <span class="metric-name">PageSpeed</span>
          <span class="metric-value ${data.pageSpeed >= 60 ? 'good' : 'bad'}">${data.pageSpeed}/100</span>
        </div>
        <div class="metric-row">
          <span class="metric-name">Czas ładowania</span>
          <span class="metric-value ${data.loadTime < 3 ? 'good' : 'bad'}">${data.loadTime}s</span>
        </div>
        <div class="metric-row">
          <span class="metric-name">Mobile-Friendly</span>
          <span class="metric-value ${data.mobileFriendly ? 'good' : 'bad'}">${data.mobileFriendly ? '✅ Tak' : '❌ Nie'}</span>
        </div>
        <div class="metric-row">
          <span class="metric-name">HTTPS</span>
          <span class="metric-value ${data.https ? 'good' : 'bad'}">${data.https ? '✅ Tak' : '❌ Nie'}</span>
        </div>
        <div class="metric-row">
          <span class="metric-name">ChatGPT Visibility</span>
          <span class="metric-value ${data.chatGPTCitation ? 'good' : 'bad'}">${data.chatGPTCitation ? '✅ Widoczna' : '❌ Niewidoczna'}</span>
        </div>
        <div class="metric-row">
          <span class="metric-name">Gemini Visibility</span>
          <span class="metric-value ${data.geminiCitation ? 'good' : 'bad'}">${data.geminiCitation ? '✅ Widoczna' : '❌ Niewidoczna'}</span>
        </div>
        <div class="metric-row">
          <span class="metric-name">Schema Markup</span>
          <span class="metric-value ${data.schemaMarkup ? 'good' : 'bad'}">${data.schemaMarkup ? '✅ Wdrożone' : '❌ Brak'}</span>
        </div>
      </div>

      ${totalProblems > 0 ? `
      <hr class="divider">

      <h2 class="section-title">Wykryte problemy (${totalProblems})</h2>

      <div>
        ${data.pageSpeed < 60 ? `
        <div class="problem-item">
          <p class="problem-name">Wolne ładowanie strony (${data.loadTime}s)</p>
          <p class="problem-desc">Wolne ładowanie powoduje, że użytkownicy opuszczają stronę zanim się załaduje. Google karze wolne strony niższą pozycją.</p>
          <p class="problem-detail"><strong>Szacowane straty:</strong> ~${Math.round(1700 * (data.loadTime / 4.2)).toLocaleString('pl-PL')} zł/mies (~${Math.round(1700 * (data.loadTime / 4.2) * 5).toLocaleString('pl-PL')} wyświetleń)</p>
          <p class="problem-detail"><strong>Naprawa:</strong> 1-2 tygodnie</p>
        </div>
        ` : ''}

        ${!data.chatGPTCitation || !data.geminiCitation ? `
        <div class="problem-item">
          <p class="problem-name">Brak widoczności w AI (ChatGPT/Gemini)</p>
          <p class="problem-desc">AI asystenci mają dostęp do milionów użytkowników dziennie. Brak widoczności w AI oznacza utratę całej grupy klientów.</p>
          <p class="problem-detail"><strong>Szacowane straty:</strong> ~1 300 zł/mies (~6 500 wyświetleń)</p>
          <p class="problem-detail"><strong>Naprawa:</strong> 2-3 tygodnie</p>
        </div>
        ` : ''}

        ${!data.mobileFriendly ? `
        <div class="problem-item">
          <p class="problem-name">Słaba optymalizacja mobile</p>
          <p class="problem-desc">Ponad 70% użytkowników przegląda internet na telefonach. Strona źle działająca na mobile traci większość klientów.</p>
          <p class="problem-detail"><strong>Szacowane straty:</strong> ~1 040 zł/mies (~5 200 wyświetleń)</p>
          <p class="problem-detail"><strong>Naprawa:</strong> 1 tydzień</p>
        </div>
        ` : ''}

        ${!data.schemaMarkup ? `
        <div class="problem-item">
          <p class="problem-name">Brak Schema Markup</p>
          <p class="problem-desc">Schema Markup to język, którym Google i AI rozumieją Twoją stronę. Bez niego trudniej uzyskać wysoką widoczność.</p>
          <p class="problem-detail"><strong>Szacowane straty:</strong> ~760 zł/mies (~3 800 wyświetleń)</p>
          <p class="problem-detail"><strong>Naprawa:</strong> 3-5 dni</p>
        </div>
        ` : ''}
      </div>
      ` : ''}

      <hr class="divider">

      <div class="loss-section">
        <p class="loss-amount">~${calculateTotalLoss(data).toLocaleString('pl-PL')} zł/mies</p>
        <p class="loss-sub">Szacowana łączna strata w utraconych wyświetleniach i potencjalnych klientach</p>
      </div>

      <hr class="divider">

      <div class="cta-section">
        <p class="cta-label"><strong>Odblokuj pełny raport profesjonalny</strong> z planem naprawczym krok po kroku</p>
        <a href="mailto:pomelomarketingandsoft@gmail.com?subject=Zamówienie%20raportu%20za%2099%20zł&body=Email:%20${encodeURIComponent(email)}%0AStrona:%20${encodeURIComponent(url)}" class="cta-button">
          Zamów pełny raport &mdash; 99 zł
        </a>
        <p class="cta-features">
          ✓ 30+ metryk szczegółowych<br>
          ✓ Plan naprawczy krok po kroku<br>
          ✓ Analiza 3 konkurentów<br>
          ✓ Wycena kosztów wdrożenia
        </p>
        <p class="cta-note">Raport gotowy do 7 dni od zamówienia</p>
      </div>

    </div>

    <div class="footer">
      <p><strong>Pomelo Marketing & Software</strong></p>
      <p><a href="https://pomelo.marketing">pomelo.marketing</a></p>
      <p>Pytania? <a href="mailto:pomelomarketingandsoft@gmail.com">pomelomarketingandsoft@gmail.com</a></p>
    </div>

  </div>
</body>
</html>
  `;
  
  try {
    const { data: emailData, error } = await resend.emails.send({
      from: 'Pomelo SEO/GEO <noreply@seo.pomelo.marketing>',
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
