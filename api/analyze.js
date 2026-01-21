// api/analyze.js

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
    console.log('Starting audit for:', url);
    
    // Run all checks in parallel
    const results = await Promise.all([
      checkPageSpeed(url),
      checkMobileFriendly(url),
      checkHTTPS(url),
      checkChatGPT(url),
      checkGemini(url),
      checkSchema(url)
    ]);

    const [pageSpeed, mobileFriendly, https, chatGPT, gemini, schema] = results;

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

    console.log('Audit complete:', auditData);

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

// === PAGESPEED CHECK ===
async function checkPageSpeed(url) {
  const API_KEY = process.env.GOOGLE_API_KEY;
  
  try {
    const response = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${API_KEY}&category=performance&strategy=mobile`
    );
    
    if (!response.ok) throw new Error('PageSpeed API failed');
    
    const data = await response.json();
    const performanceScore = Math.round(data.lighthouseResult.categories.performance.score * 100);
    const speedIndex = data.lighthouseResult.audits['speed-index'].numericValue / 1000;
    
    return {
      score: performanceScore,
      loadTime: parseFloat(speedIndex.toFixed(1))
    };
  } catch (error) {
    console.error('PageSpeed error:', error);
    return { score: 50, loadTime: 3.5 };
  }
}

// === MOBILE-FRIENDLY CHECK (z PageSpeed) ===
async function checkMobileFriendly(url) {
  const API_KEY = process.env.GOOGLE_API_KEY;
  
  try {
    const response = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${API_KEY}&strategy=mobile`
    );
    
    if (!response.ok) throw new Error('PageSpeed mobile API failed');
    
    const data = await response.json();
    const viewportAudit = data.lighthouseResult.audits['viewport'];
    const isMobileFriendly = viewportAudit && viewportAudit.score === 1;
    
    return { passed: isMobileFriendly };
  } catch (error) {
    console.error('Mobile-Friendly error:', error);
    return { passed: true };
  }
}

// === HTTPS CHECK ===
async function checkHTTPS(url) {
  return { secure: url.startsWith('https://') };
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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`,
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
    const hasOrgSchema = html.includes('"@type":"Organization"') || html.includes('"@type": "Organization"');
    const hasLocalBusiness = html.includes('"@type":"LocalBusiness"') || html.includes('"@type": "LocalBusiness"');
    
    return { hasSchema: hasJsonLd && (hasOrgSchema || hasLocalBusiness) };
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

// === SEND EMAIL ===
// === SEND EMAIL ===
async function sendEmailReport(email, url, data) {
  console.log('===== EMAIL DEBUG START =====');
  console.log('Recipient:', email);
  console.log('URL:', url);
  console.log('Score:', data.score);
  console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY ? 'SET' : 'NOT SET');
  
  if (!process.env.RESEND_API_KEY) {
    console.error('❌ BŁĄD: Brak zmiennej RESEND_API_KEY!');
    console.log('Ustaw ją w Vercel Dashboard → Settings → Environment Variables');
    throw new Error('Missing email configuration');
  }
  
  const { Resend } = await import('resend');
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
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 42px;
          font-weight: bold;
          border: 4px solid rgba(255,255,255,0.3);
        }
        .content { padding: 40px 30px; }
        .metric-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin: 25px 0;
        }
        .metric-box {
          background: #f9fafb;
          padding: 15px;
          border-radius: 8px;
          border-left: 3px solid #e5e7eb;
        }
        .metric-box.good { border-left-color: #10b981; }
        .metric-box.bad { border-left-color: #ef4444; }
        .cta-button { 
          background: linear-gradient(135deg, #9333ea 0%, #ec4899 100%);
          color: white; 
          padding: 16px 32px; 
          text-decoration: none; 
          border-radius: 8px; 
          display: inline-block; 
          font-weight: bold;
          font-size: 16px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚀 Twój Audyt SEO/GEO</h1>
          <div class="score-circle">${data.score}%</div>
          <p>Widoczność: ${statusEmoji} ${statusText}</p>
        </div>
        <div class="content">
          <h2>📊 Wyniki dla ${url}</h2>
          <div class="metric-grid">
            <div class="metric-box ${data.pageSpeed >= 60 ? 'good' : 'bad'}">
              PageSpeed: ${data.pageSpeed}%
            </div>
            <div class="metric-box ${data.loadTime < 3 ? 'good' : 'bad'}">
              Czas: ${data.loadTime}s
            </div>
          </div>
          <p><strong>${totalProblems} problemów</strong> wymaga naprawy.</p>
          <p style="text-align: center; margin: 30px 0;">
            <a href="mailto:pomelomarketingandsoft@gmail.com?subject=Raport dla ${encodeURIComponent(url)}" class="cta-button">
              Odblokuj pełny raport za 19 zł
            </a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  try {
    const { data: emailData, error } = await resend.emails.send({
      from: 'Pomelo SEO/GEO <onboarding@resend.dev>', // Zmień po weryfikacji domeny
      to: [email],
      subject: `${statusEmoji} Wynik: ${data.score}% - ${totalProblems} problemów`,
      html: emailHtml,
    });

    if (error) {
      throw error;
    }
    
    console.log('✅ Email sent successfully to:', email);
    console.log('Email ID:', emailData.id);
    console.log('===== EMAIL DEBUG END =====');
    
    return emailData;
    
  } catch (error) {
    console.error('❌ Email send error:', error);
    console.error('Error details:', error.message);
    console.log('===== EMAIL DEBUG END =====');
    throw error;
  }
}
```

**KROK 3:** Ustaw w Vercel:
```
RESEND_API_KEY = re_twoj_klucz_z_resend_com
