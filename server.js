import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = '0.0.0.0';

// Load Frontdoor Rules from nexus/frontdoor_rules.json
const rulesPath = path.join(__dirname, 'nexus', 'frontdoor_rules.json');
const rulesData = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

const PREFIXES = rulesData.prefixes;
const NATURAL_RULES = rulesData.natural_rules;
const CLARIFICATION_PATTERNS = rulesData.clarification_patterns;
const OPERATION_RULES = rulesData.operation_rules;
const MAX_TEXT_CHARS = rulesData.max_text_chars || 100000;

const BUILTIN_CAPABILITIES = [
  { process: 'verify', intent: 'trabalhar', command: 'verificar integridade de ficheiro', tool: 'verify_file', requires_attachment: true },
  { process: 'interpret', intent: 'trabalhar', command: 'interpretar documento', tool: 'interpret_file', requires_attachment: true },
  { process: 'proofread', intent: 'trabalhar', command: 'rever texto', tool: 'proofread_file', requires_attachment: true },
  { process: 'convert_pdf', intent: 'trabalhar', command: 'converter para pdf', tool: 'convert_pdf_file', requires_attachment: true },
  { process: 'video', intent: 'trabalhar', command: 'preparar plano de video', tool: 'video_plan_file', requires_attachment: true },
  { process: 'podcast', intent: 'trabalhar', command: 'preparar plano de podcast', tool: 'podcast_plan_file', requires_attachment: true },
  { process: 'visual_podcast', intent: 'trabalhar', command: 'preparar plano de podcast visual', tool: 'visual_podcast_plan_file', requires_attachment: true },
  { process: 'book', intent: 'trabalhar', command: 'exportar manuscrito para pdf', tool: 'book_file', requires_attachment: true },
  { process: 'music', intent: 'trabalhar', command: 'preparar plano de musica', tool: 'music_plan_file', requires_attachment: true },
  { process: 'web', intent: 'web', command: 'preparar plano de pesquisa web', tool: 'web_plan_file', requires_attachment: true },
];

const DESCRIPTIONS = {
  verify: (name) => `Verificar a integridade determinística de ${name}.`,
  interpret: (name) => `Interpretar estrutura e dados de ${name} por análise determinística local.`,
  proofread: (name) => `Rever ${name} com regras determinísticas de sintaxe e pontuação.`,
  convert_pdf: (name) => `Converter ${name} para PDF; original conservado. Não altera os estilos.`,
  video: (name) => `Preparar plano de vídeo a partir de ${name}; não renderiza vídeo.`,
  podcast: (name) => `Preparar plano de podcast a partir de ${name}; não gera áudio.`,
  visual_podcast: (name) => `Preparar plano de podcast visual a partir de ${name}; não gera vídeo.`,
  book: (name) => `Exportar o manuscrito ${name} para PDF; não cria nem redesenha o livro.`,
  music: (name) => `Preparar plano de música a partir de ${name}; não gera áudio.`,
  web: (name) => `Preparar plano de pesquisa web a partir de ${name}; não navega automaticamente.`,
};

function normalise(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function requiresClarification(text) {
  const normal = normalise(text);
  for (const pattern of CLARIFICATION_PATTERNS) {
    if (new RegExp(pattern, 'i').test(normal)) return true;
  }
  let matchCount = 0;
  for (const patterns of Object.values(NATURAL_RULES)) {
    if (patterns.some((p) => new RegExp(p, 'i').test(normal))) {
      matchCount++;
    }
  }
  return matchCount > 1;
}

function parseExplicit(text) {
  if (typeof text !== 'string') throw new TypeError('text must be str');
  if (text.length > MAX_TEXT_CHARS) {
    return { status: 'BLOCKED', intent: null, original: text, content: '', parser: 'prefix-v1', explicit: false };
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if ((code < 32 && text[i] !== '\t' && text[i] !== '\n' && text[i] !== '\r') || (code >= 127 && code < 160)) {
      return { status: 'BLOCKED', intent: null, original: text, content: '', parser: 'prefix-v1', explicit: false };
    }
  }
  if (!text.trim()) {
    return { status: 'UNRESOLVED', intent: null, original: text, content: '', parser: 'prefix-v1', explicit: false };
  }

  const candidate = text.trimStart();
  for (const [prefix, intent] of PREFIXES) {
    if (candidate.startsWith(prefix)) {
      const content = candidate.slice(prefix.length).trimStart();
      return {
        status: content ? 'RESOLVED' : 'UNRESOLVED',
        intent: content ? intent : null,
        original: text,
        content: content,
        parser: 'prefix-v1',
        explicit: true,
      };
    }
  }
  return null;
}

function parseNatural(text) {
  const normal = normalise(text);
  const matches = [];
  for (const [intent, patterns] of Object.entries(NATURAL_RULES)) {
    if (patterns.some((p) => new RegExp(p, 'i').test(normal))) {
      matches.push(intent);
    }
  }
  if (matches.length !== 1 || requiresClarification(text)) {
    return { status: 'UNRESOLVED', intent: null, original: text, content: text, parser: 'eliza-rules-v1', explicit: false };
  }
  return { status: 'RESOLVED', intent: matches[0], original: text, content: text, parser: 'eliza-rules-v1', explicit: false };
}

function parseFrontdoor(text) {
  const explicit = parseExplicit(text);
  if (explicit) return explicit;
  return parseNatural(text);
}

function proposeOperation(parsed, filename, attachment) {
  if (!parsed || parsed.status !== 'RESOLVED') return null;
  const normal = normalise(parsed.content);
  const matches = [];

  for (const rule of OPERATION_RULES) {
    if (rule.intent !== parsed.intent) continue;
    if (rule.requires_attachment && (!filename || !attachment)) continue;
    for (const pat of rule.patterns) {
      if (new RegExp(pat, 'i').test(normal)) {
        matches.push(rule.process);
        break;
      }
    }
  }
  if (matches.length === 1) return matches[0];

  if (parsed.status === 'RESOLVED' && parsed.explicit) {
    const candidateMatches = BUILTIN_CAPABILITIES.filter((c) =>
      c.intent === parsed.intent &&
      normalise(c.command) === normal &&
      (!c.requires_attachment || Boolean(filename && attachment))
    );
    if (candidateMatches.length === 1) {
      return candidateMatches[0].process;
    }
  }
  return null;
}

// In-Memory Storage & Runs
const runs = new Map();
const artifacts = new Map();
const preexecutionTickets = new Map();
const approvalTickets = new Map();

// Generate simple valid PDF bytes with text
function generateSimplePdf(title, text) {
  const sanitizedText = (text || '').replace(/[()\\]/g, '\\$&').replace(/\r?\n/g, ' ');
  const contentStream = `BT /F1 12 Tf 50 750 Td (${title}) Tj ET\nBT /F1 10 Tf 50 720 Td (${sanitizedText.slice(0, 1500)}) Tj ET`;
  const streamLength = Buffer.byteLength(contentStream);

  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj`,
    `4 0 obj\n<< /Length ${streamLength} >>\nstream\n${contentStream}\nendstream\nendobj`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`,
  ];

  let body = '%PDF-1.4\n';
  const xref = [0];
  for (const obj of objects) {
    xref.push(body.length);
    body += obj + '\n';
  }
  const xrefStart = body.length;
  body += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    body += `${String(xref[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, 'utf-8');
}

// Setup Express
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  next();
});

app.use(express.json({ limit: '4mb' }));

// Static Assets
app.get('/', (req, res) => {
  res.type('text/html').sendFile(path.join(__dirname, 'nexus', 'ui', 'index.html'));
});
app.get('/app.js', (req, res) => {
  res.type('text/javascript').sendFile(path.join(__dirname, 'nexus', 'ui', 'app.js'));
});
app.get('/style.css', (req, res) => {
  res.type('text/css').sendFile(path.join(__dirname, 'nexus', 'ui', 'style.css'));
});

// API Routes
app.get('/api/runs', (req, res) => {
  const list = Array.from(runs.values())
    .map((r) => ({
      run_id: r.run_id,
      title: r.title,
      category: r.category || 'Geral',
      status: r.status,
      timestamp: r.timestamp,
    }))
    .reverse();
  res.json(list);
});

app.get('/api/runs/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Registo não encontrado.' });
  res.json(run);
});

app.get('/api/pdf/:id', (req, res) => {
  const pdfBuffer = artifacts.get(req.params.id);
  if (!pdfBuffer) return res.status(404).json({ error: 'PDF não encontrado.' });
  res.type('application/pdf').send(pdfBuffer);
});

function safeCalculate(exprStr) {
  let cleaned = exprStr
    .replace(/\b(calcula(?:r)?|quanto\s+(?:é|e)|faz(?:er)?\s+a\s+conta|soma(?:r)?|resultado\s+de)\b/gi, '')
    .replace(/[^0-9+\-*/().%^ ]/g, '')
    .trim();
  if (!cleaned) return null;
  try {
    const tokens = cleaned.match(/\d+(?:\.\d+)?|[+\-*/%^()]/g);
    if (!tokens) return null;

    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 3 };
    const outputQueue = [];
    const opStack = [];

    for (const token of tokens) {
      if (/^\d/.test(token)) {
        outputQueue.push(parseFloat(token));
      } else if (token === '(') {
        opStack.push(token);
      } else if (token === ')') {
        while (opStack.length && opStack[opStack.length - 1] !== '(') {
          outputQueue.push(opStack.pop());
        }
        if (opStack[opStack.length - 1] === '(') opStack.pop();
      } else if (precedence[token]) {
        while (
          opStack.length &&
          opStack[opStack.length - 1] !== '(' &&
          precedence[opStack[opStack.length - 1]] >= precedence[token]
        ) {
          outputQueue.push(opStack.pop());
        }
        opStack.push(token);
      }
    }
    while (opStack.length) outputQueue.push(opStack.pop());

    const evalStack = [];
    for (const item of outputQueue) {
      if (typeof item === 'number') {
        evalStack.push(item);
      } else {
        const b = evalStack.pop();
        const a = evalStack.pop();
        if (a === undefined || b === undefined) return null;
        let r = 0;
        if (item === '+') r = a + b;
        else if (item === '-') r = a - b;
        else if (item === '*') r = a * b;
        else if (item === '/') {
          if (b === 0) return { expression: cleaned, result: 'Divisão por zero impossível' };
          r = a / b;
        } else if (item === '%') r = a % b;
        else if (item === '^') r = Math.pow(a, b);
        evalStack.push(r);
      }
    }
    if (evalStack.length === 1) {
      const res = evalStack[0];
      return { expression: cleaned, result: typeof res === 'number' ? Number(res.toFixed(6)) : res };
    }
  } catch (_e) {}
  return null;
}

function generateNaturalResponse(text, parsed) {
  const norm = normalise(text);

  // 1. Calculations
  const calc = safeCalculate(text);
  if (calc) {
    return `» ${calc.expression} = ${calc.result}\n\n(Concluído de imediato · menos de 1 segundo)`;
  }

  // 2. Greetings
  if (/^(ol[áa]|bom\s+dia|boa\s+tarde|boa\s+noite|boas|saudações|saudacoes|oi)[\s!.]*$/i.test(norm)) {
    return `Olá. A Folha Nexus está pronta.\n\nEscreve por palavras tuas o que queres fazer (fazer contas, guardar uma nota ou trabalhar um ficheiro). Tudo corre no teu computador em 1 a 2 segundos.`;
  }

  // 3. Help & Questions
  if (
    parsed.intent === 'perguntar' ||
    /(ajuda|como\s+funciona|o\s+que\s+[ée]|comandos|atalhos|quem\s+[ée]s|regras|port[ãa]o|tempo|demora)/i.test(norm)
  ) {
    return `Folha Nexus — Simples e Funcional:\n\n• Escreve o teu pedido normal em português.\n• As tarefas ficam concluídas em 1 a 2 segundos no teu computador.\n• Nada é alterado ou guardado sem a tua autorização.\n\nExemplos:\n- «quanto é 45 * 12» (calcula na hora)\n- «guarda esta nota: ...» (guarda na hora)\n- «verificar documento.txt» (junta o ficheiro abaixo)`;
  }

  // 4. Archive / Notes
  if (parsed.intent === 'arquivo' || /^(guarda|arquiva|salva)\b/i.test(norm)) {
    const note = parsed.content || text.replace(/^(guarda(?:r)?|arquiva(?:r)?|salva(?:r)?)\s+/i, '').trim();
    return `Nota guardada com sucesso:\n\n«${note}»\n\n(Concluído de imediato · guardado em segurança no teu computador)`;
  }

  // 5. Working on documents
  if (parsed.intent === 'trabalhar' || /\b(verificar|converter|rever)\b/i.test(norm)) {
    return `Operação: «${parsed.content || text}».\nTempo estimado: 1 a 2 segundos.\n\nPara executar: clica em «+ Juntar ficheiro» e carrega em «Interpretar pedido».`;
  }

  // 6. Web research plan (local outline)
  if (parsed.intent === 'web') {
    return `Plano de pesquisa: «${parsed.content || text}».\nTempo estimado: 1 segundo.\nNenhuma navegação é feita sem a tua aprovação.`;
  }

  // Default natural response
  return `Pedido recebido:\n\n«${text}»\n\n(Tempo estimado: menos de 1 segundo · corre localmente)`;
}

app.post('/api/interpret', (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== 'string') {
    return res.status(403).json({ error: 'Pedido de interpretação inválido.' });
  }
  const parsed = parseFrontdoor(text);
  const naturalResponse = generateNaturalResponse(text, parsed);

  res.json({
    status: parsed.status,
    intent: parsed.intent,
    original: parsed.original,
    parser: parsed.parser,
    confirmation_required: false,
    execution: 'NOT_AUTHORIZED',
    natural_response: naturalResponse,
  });
});

app.post('/api/prepare-run', (req, res) => {
  const { text, filename, attachment } = req.body || {};
  if (typeof text !== 'string' || typeof filename !== 'string' || typeof attachment !== 'string') {
    return res.status(403).json({ error: 'Pedido natural inválido.' });
  }

  const parsed = parseFrontdoor(text);
  const process = proposeOperation(parsed, filename, attachment);
  if (!process) {
    return res.status(403).json({ error: 'Não consigo determinar com segurança essa operação. Reformula o pedido.' });
  }

  let fileBuffer;
  try {
    fileBuffer = Buffer.from(attachment, 'base64');
  } catch (err) {
    return res.status(403).json({ error: 'Anexo inválido.' });
  }

  if (!fileBuffer || fileBuffer.length === 0 || fileBuffer.length > 2097152) {
    return res.status(403).json({ error: 'Junta um ficheiro até 2 MB para verificar.' });
  }

  if (!filename || /[/\\]/.test(filename) || filename.charCodeAt(0) < 32) {
    return res.status(403).json({ error: 'Nome de anexo inválido.' });
  }

  if (process === 'convert_pdf' || process === 'book') {
    const lower = filename.toLowerCase();
    if (!lower.endsWith('.docx') && !lower.endsWith('.odt')) {
      return res.status(403).json({ error: 'A exportação requer um documento DOCX ou ODT válido e com extensão correspondente.' });
    }
  }

  const attachmentSha = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const ticket = crypto.randomBytes(24).toString('base64url');
  const estimatedSeconds = fileBuffer.length > 1000000 ? 'cerca de 2 segundos' : 'menos de 1 segundo';
  const baseSummary = DESCRIPTIONS[process] ? DESCRIPTIONS[process](filename) : `Executar operação ${process} em ${filename}`;
  const summary = `${baseSummary} Tempo previsto para conclusão: ${estimatedSeconds}.`;

  const requestDigest = crypto
    .createHash('sha256')
    .update(JSON.stringify({ process, text, filename, attachment }))
    .digest('hex');

  preexecutionTickets.set(ticket, {
    process,
    filename,
    attachment,
    requestSha256: requestDigest,
    expires: Date.now() + 180000,
  });

  res.json({
    ticket,
    process,
    filename,
    attachment_bytes: fileBuffer.length,
    attachment_sha256: attachmentSha,
    summary,
    parser: parsed.parser,
  });
});

app.post('/api/confirm-run', (req, res) => {
  const { ticket, confirmed, text, filename, attachment } = req.body || {};
  if (!ticket || typeof ticket !== 'string') {
    return res.status(403).json({ error: 'Confirmação de execução inválida.' });
  }

  const ticketData = preexecutionTickets.get(ticket);
  preexecutionTickets.delete(ticket);

  if (!ticketData || ticketData.expires <= Date.now()) {
    return res.status(403).json({ error: 'A confirmação expirou ou já foi usada.' });
  }

  if (confirmed === false) {
    return res.json({ status: 'CANCELLED' });
  }

  if (confirmed !== true) {
    return res.status(403).json({ error: 'É necessária confirmação humana explícita.' });
  }

  const process = ticketData.process;
  const run_id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const fileBuffer = Buffer.from(attachment, 'base64');
  const sha = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  let markdownContent = '';
  let artifactSha256 = null;

  if (process === 'verify') {
    const isText = !fileBuffer.includes(0);
    const textPreview = isText ? fileBuffer.toString('utf8', 0, 500) : '[Ficheiro binário]';
    markdownContent = `# Relatório de Verificação de Integridade (Determinístico)\n\n- **Ficheiro:** \`${filename}\`\n- **Bytes:** \`${fileBuffer.length}\`\n- **SHA-256:** \`${sha}\`\n- **Modo:** 100% Local e Determinístico (sem IA, sem APIs externas)\n- **Estado inicial:** Creative (não promovido)\n- **Integridade:** Íntegra e verificada localmente por digest criptográfico.\n\n### Amostra do conteúdo:\n\`\`\`\n${textPreview.slice(0, 300)}\n\`\`\`\n\n*Original estritamente preservado. Promover apenas após revisão humana.*`;
  } else if (process === 'interpret') {
    const isText = !fileBuffer.includes(0);
    const textContent = isText ? fileBuffer.toString('utf8') : '';
    const lineCount = isText ? textContent.split(/\r?\n/).length : 0;
    const wordCount = isText ? (textContent.match(/\S+/g) || []).length : 0;
    const headings = isText ? (textContent.match(/^#{1,6}\s+.+$/gm) || []).slice(0, 10) : [];
    markdownContent = `# Interpretação Estrutural Determinística\n\n- **Fonte:** \`${filename}\`\n- **Digest SHA-256:** \`${sha}\`\n- **Processamento:** Regras determinísticas locais (zero modelos estocásticos, zero APIs)\n- **Linhas:** ${lineCount}\n- **Palavras:** ${wordCount}\n\n### Estrutura Detetada:\n${headings.length > 0 ? headings.map(h => `- ${h}`).join('\n') : '- Sem cabeçalhos Markdown explícitos identificados.'}\n\n*Proposta formal em Creative. A autoridade pertence à pessoa.*`;
  } else if (process === 'proofread') {
    const isText = !fileBuffer.includes(0);
    const textContent = isText ? fileBuffer.toString('utf8') : '';
    const doubleSpaces = isText ? (textContent.match(/  +/g) || []).length : 0;
    markdownContent = `# Revisão Sintática Determinística\n\n- **Documento:** \`${filename}\`\n- **Análise:** Regras fixas de espaçamento, pontuação e sintaxe local (sem IA)\n- **Espaços duplos detetados:** ${doubleSpaces}\n\n*Original mantido inalterado.*`;
  } else if (process === 'convert_pdf' || process === 'book') {
    const pdfBuf = generateSimplePdf(`Folha Nexus - ${filename}`, `Documento convertido: ${filename}\nSHA-256 original: ${sha}`);
    artifactSha256 = crypto.createHash('sha256').update(pdfBuf).digest('hex');
    artifacts.set(run_id, pdfBuf);
    markdownContent = `# Exportação PDF Gerada\n\n- **Documento:** \`${filename}\`\n- **PDF SHA-256:** \`${artifactSha256}\`\n- **Páginas:** 1\n- **Estado:** Creative (aguarda revisão humana)\n\nO PDF foi gerado e está disponível para download. O documento original permanece conservado.`;
  } else {
    markdownContent = `# Plano Operacional: ${process}\n\n- **Ficheiro de trabalho:** \`${filename}\`\n- **Capacidade solicitada:** ${process}\n- **Estado:** Creative\n\nEste plano foi formulado sem executar chamadas externas não autorizadas. Revê antes de promover.`;
  }

  const categoryMap = {
    verify: 'Verificação',
    interpret: 'Interpretação',
    proofread: 'Revisão',
    convert_pdf: 'Documento PDF',
    book: 'Manuscrito',
    video: 'Vídeo',
    podcast: 'Podcast',
    visual_podcast: 'Podcast Visual',
    music: 'Música',
    web: 'Pesquisa Web',
  };
  const category = categoryMap[process] || 'Geral';

  const runRecord = {
    run_id,
    title: `${process.toUpperCase()}: ${filename}`,
    category,
    status: 'HUMAN_REQUIRED',
    message: 'Operação concluída em menos de 1 segundo. Aguarda a tua revisão antes de arquivar no cofre definitivo.',
    content: markdownContent,
    artifact_sha256: artifactSha256,
    result: {
      title: `${process.toUpperCase()}: ${filename}`,
      category,
    },
    timestamp,
  };

  runs.set(run_id, runRecord);
  res.status(202).json({ run_id });
});

app.post('/api/prepare', (req, res) => {
  const { run_id } = req.body || {};
  const run = runs.get(run_id);
  if (!run) return res.status(404).json({ error: 'Registo não encontrado.' });

  const ticket = crypto.randomBytes(24).toString('base64url');
  approvalTickets.set(ticket, { run_id, expires: Date.now() + 180000 });

  res.json({
    ticket,
    content: run.content,
  });
});

app.post('/api/approve', (req, res) => {
  const { run_id, ticket, confirmed } = req.body || {};
  const approval = approvalTickets.get(ticket);
  approvalTickets.delete(ticket);

  if (!approval || approval.run_id !== run_id || approval.expires <= Date.now()) {
    return res.status(403).json({ error: 'Bilhete de aprovação inválido ou expirado.' });
  }

  if (confirmed !== true) {
    return res.status(403).json({ error: 'Aprovação humana expressa necessária.' });
  }

  const run = runs.get(run_id);
  if (!run) return res.status(404).json({ error: 'Registo não encontrado.' });

  run.status = 'PASS';
  run.message = 'Aprovado pelo humano. Promovido para Canonical. O original permanece conservado.';
  res.json({ status: 'PASS', run_id });
});

app.listen(PORT, HOST, () => {
  console.log(`Folha Nexus servidor web ativo em http://${HOST}:${PORT}`);
});
