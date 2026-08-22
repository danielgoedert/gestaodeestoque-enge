// ===== DATA.JS - Banco de dados local seguro (localStorage) & Security & SQL Protection Engine =====

const Security = {
  // Gera salt criptográfico seguro
  generateSalt(len = 16) {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
      const bytes = new Uint8Array(len);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return Array.from({ length: len }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
  },

  // SHA-256 síncrono nativo em JS (garante disponibilidade universal)
  sha256Sync(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let i, j;
    let result = '';
    const words = [];
    const asciiBitLength = ascii.length * 8;
    let hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    for (i = 0; i < ascii.length; i++) {
      const code = ascii.charCodeAt(i);
      words[i >> 2] |= (code & 0xff) << (24 - (i % 4) * 8);
    }
    words[asciiBitLength >> 5] |= 0x80 << (24 - (asciiBitLength % 32));
    words[(((asciiBitLength + 64) >> 9) << 4) + 15] = asciiBitLength;

    for (i = 0; i < words.length; i += 16) {
      const w = [];
      for (j = 0; j < 16; j++) w[j] = words[i + j] | 0;
      for (j = 16; j < 64; j++) {
        const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
      let e = hash[4], f = hash[5], g = hash[6], h = hash[7];
      for (j = 0; j < 64; j++) {
        const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        const ch = (e & f) ^ ((~e) & g);
        const temp1 = (h + S1 + ch + k[j] + w[j]) | 0;
        const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }
      hash[0] = (hash[0] + a) | 0;
      hash[1] = (hash[1] + b) | 0;
      hash[2] = (hash[2] + c) | 0;
      hash[3] = (hash[3] + d) | 0;
      hash[4] = (hash[4] + e) | 0;
      hash[5] = (hash[5] + f) | 0;
      hash[6] = (hash[6] + g) | 0;
      hash[7] = (hash[7] + h) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j >= 0; j--) {
        const byte = (hash[i] >> (j * 8)) & 0xff;
        result += byte.toString(16).padStart(2, '0');
      }
    }
    return result;
  },

  // Hash assíncrono com salt via WebCrypto (com fallback para sha256Sync)
  async hashPassword(password, salt) {
    const combined = `${salt}:${password}`;
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      try {
        const msgBuffer = new TextEncoder().encode(combined);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      } catch {
        // Fallback para implementação síncrona
      }
    }
    return this.sha256Sync(combined);
  },

  // Escape de HTML completo e seguro contra XSS
  esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/`/g, '&#96;')
      .replace(/\//g, '&#x2F;');
  },

  // Sanitizador de identificadores para uso seguro em atributos HTML
  sanitizeId(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[^a-zA-Z0-9_\-.]/g, '');
  },

  // Sanitizador de texto contra caracteres de controle e estouro de buffer
  sanitizeText(str, maxLength = 255) {
    if (typeof str !== 'string') return '';
    const cleaned = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    return cleaned.slice(0, maxLength);
  },

  // Validação e sanitização de números
  sanitizeNumber(val, defaultVal = 0, min = 0, max = 1e9) {
    const num = Number(val);
    if (!Number.isFinite(num) || Number.isNaN(num)) return defaultVal;
    return Math.max(min, Math.min(max, num));
  },

  // Sanitização estrita contra CSV / Spreadsheet Formula Injection (CWE-1236)
  sanitizeCsvCell(value) {
    let content = String(value ?? '');
    if (/^[=+\-@\t\r|%]/.test(content)) {
      content = `'${content}`;
    }
    return `"${content.replace(/"/g, '""')}"`;
  },

  // ===== MOTOR DE DEFESA CONTRA SQL INJECTION =====

  // Detecção de padrões de injeção de SQL
  detectSqlInjection(input) {
    if (typeof input !== 'string') return false;
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|UNION|TRUNCATE|DECLARE)\b)/i,
      /(--|\/\*|\*\/|;)/,
      /(\bOR\b|\bAND\b)\s+(['"]?\w+['"]?\s*=\s*['"]?\w+['"]?)/i,
      /(\bUNION\s+ALL\s+SELECT\b|\bUNION\s+SELECT\b)/i,
      /(\bSLEEP\s*\(|\bBENCHMARK\s*\(|\bWAITFOR\s+DELAY\b)/i,
      /(\bINFORMATION_SCHEMA\b|\bSYS\.TABLES\b|\bPG_TABLES\b)/i,
      /(0x[0-9a-fA-F]+|\bCHAR\s*\(|\bCONCAT\s*\()/i,
      /(\bXP_\w+|\bSP_\w+)/i
    ];
    return sqlPatterns.some(pattern => pattern.test(input));
  },

  // Sanitizador estrito contra SQL Injection para strings
  escapeSqlString(value) {
    if (value === null || value === undefined) return 'NULL';
    const str = String(value);
    return "'" + str
      .replace(/[\0\n\r\b\t\\'\x1a]/g, function (s) {
        switch (s) {
          case "\0": return "\\0";
          case "\n": return "\\n";
          case "\r": return "\\r";
          case "\b": return "\\b";
          case "\t": return "\\t";
          case "\x1a": return "\\Z";
          case "'": return "''";
          case "\\": return "\\\\";
          default: return "\\" + s;
        }
      }) + "'";
  },

  // Validador e escapador de identificadores SQL (tabelas, colunas, aliases)
  escapeSqlIdentifier(identifier) {
    const clean = String(identifier || '').trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(clean)) {
      throw new Error(`Identificador SQL inválido ou suspeito de injeção: ${clean}`);
    }
    return `"${clean}"`;
  },

  // Validador de parâmetros tipados para Prepared Statements
  validateSqlParam(param) {
    if (param === null || param === undefined) return null;
    if (typeof param === 'number') {
      if (!Number.isFinite(param)) throw new Error('Parâmetro numérico SQL inválido (NaN/Infinity).');
      return param;
    }
    if (typeof param === 'boolean') return param;
    if (typeof param === 'string') {
      if (this.detectSqlInjection(param)) {
        this.logAudit('SQL_INJECTION_DETECTADA', `Tentativa de SQL Injection neutralizada: ${param.slice(0, 80)}`, 'CRITICAL');
      }
      return this.sanitizeText(param, 1000);
    }
    if (param instanceof Date) return param.toISOString();
    return JSON.stringify(param);
  },

  // Compilador seguro de consultas parametrizadas (Prepared Statements)
  compilePreparedStatement(sql, params = []) {
    if (typeof sql !== 'string') throw new Error('A consulta SQL deve ser uma string.');

    if (/;\s*\S/.test(sql)) {
      this.logAudit('SQL_INJECTION_BLOQUEADA', 'Tentativa de execução de consultas SQL empilhadas (;).', 'CRITICAL');
      throw new Error('Execução de múltiplas consultas empilhadas não permitida.');
    }

    let paramIndex = 0;
    const compiled = sql.replace(/\?/g, () => {
      if (paramIndex >= params.length) {
        throw new Error(`Número insuficiente de parâmetros para a consulta SQL.`);
      }
      const param = this.validateSqlParam(params[paramIndex++]);
      return param === null ? 'NULL' : (typeof param === 'number' || typeof param === 'boolean') ? String(param) : this.escapeSqlString(param);
    });

    return compiled.replace(/:([a-zA-Z0-9_]+)/g, (match, paramName) => {
      if (!params || typeof params !== 'object' || !(paramName in params)) {
        throw new Error(`Parâmetro nomeado SQL :${paramName} não fornecido.`);
      }
      const param = this.validateSqlParam(params[paramName]);
      return param === null ? 'NULL' : (typeof param === 'number' || typeof param === 'boolean') ? String(param) : this.escapeSqlString(param);
    });
  },

  // Proteção contra ataques de força bruta (Rate Limiting)
  RATE_LIMIT_KEY: 'ep_rate_limit',
  MAX_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 30000, // 30 segundos de bloqueio

  getRateLimitState() {
    try {
      const raw = sessionStorage.getItem(this.RATE_LIMIT_KEY) || localStorage.getItem(this.RATE_LIMIT_KEY);
      return raw ? JSON.parse(raw) : { attempts: 0, lockedUntil: 0 };
    } catch {
      return { attempts: 0, lockedUntil: 0 };
    }
  },

  checkRateLimit() {
    const state = this.getRateLimitState();
    const now = Date.now();
    if (state.lockedUntil && now < state.lockedUntil) {
      const remainingSec = Math.ceil((state.lockedUntil - now) / 1000);
      return { allowed: false, remainingSec };
    }
    if (state.lockedUntil && now >= state.lockedUntil) {
      this.resetRateLimit();
    }
    return { allowed: true, remainingSec: 0 };
  },

  recordFailedLogin() {
    const state = this.getRateLimitState();
    state.attempts = (state.attempts || 0) + 1;
    if (state.attempts >= this.MAX_ATTEMPTS) {
      state.lockedUntil = Date.now() + this.LOCKOUT_DURATION_MS;
    }
    const val = JSON.stringify(state);
    try {
      sessionStorage.setItem(this.RATE_LIMIT_KEY, val);
      localStorage.setItem(this.RATE_LIMIT_KEY, val);
    } catch {}
  },

  resetRateLimit() {
    try {
      sessionStorage.removeItem(this.RATE_LIMIT_KEY);
      localStorage.removeItem(this.RATE_LIMIT_KEY);
    } catch {}
  },

  // Matriz de Controle de Acesso Baseado em Funções (RBAC)
  PERMISSIONS: {
    'Administrador': [
      'view_dashboard', 'view_products', 'create_product', 'edit_product', 'delete_product',
      'view_stock', 'create_movement', 'view_purchases', 'create_purchase',
      'view_suppliers', 'create_supplier', 'evaluate_supplier',
      'view_reports', 'export_reports',
      'view_automations', 'manage_automations',
      'view_settings', 'manage_users', 'view_audit'
    ],
    'Operador': [
      'view_dashboard', 'view_products', 'create_product', 'edit_product',
      'view_stock', 'create_movement', 'view_purchases', 'create_purchase',
      'view_suppliers', 'evaluate_supplier',
      'view_reports', 'export_reports'
    ]
  },

  can(action, user = null) {
    const activeUser = user || (typeof state !== 'undefined' ? state.user : null);
    if (!activeUser || !activeUser.perfil) return false;
    const allowed = this.PERMISSIONS[activeUser.perfil] || [];
    return allowed.includes(action);
  },

  // Trilha de Auditoria (Audit Log)
  logAudit(action, details, status = 'SUCCESS', customUser = null) {
    try {
      const logs = DB.get('audit_log') || [];
      const actor = customUser || (typeof state !== 'undefined' ? state.user : null) || { nome: 'Anônimo/Sistema', email: 'sistema' };
      const currentIp = (typeof state !== 'undefined' && state.clientIp) ? state.clientIp : '127.0.0.1';
      const currentDev = (typeof state !== 'undefined' && state.clientDevice) ? state.clientDevice : 'Navegador Web';
      const entry = {
        id: Date.now() + Math.random().toString(36).slice(2, 6),
        timestamp: new Date().toISOString(),
        actorName: actor.nome || 'Anônimo',
        actorEmail: actor.email || 'sistema',
        actorPerfil: actor.perfil || 'Desconhecido',
        action: action,
        details: typeof details === 'object' ? JSON.stringify(details) : String(details),
        status: status,
        ip: currentIp,
        device: currentDev,
        userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : 'Desconhecido').slice(0, 80)
      };
      logs.unshift(entry);
      DB.set('audit_log', logs.slice(0, 100));
    } catch (e) {
      console.warn('Não foi possível gravar log de auditoria:', e);
    }
  }
};

const DB = {
  init() {
    // 1. Inicialização segura de Usuários com Salt e Hash SHA-256
    let usuarios = this.get('usuarios');
    if (!usuarios || usuarios.length === 0) {
      const saltAdmin = Security.generateSalt(16);
      const hashAdmin = Security.sha256Sync(saltAdmin + ':123456');
      const saltJoao = Security.generateSalt(16);
      const hashJoao = Security.sha256Sync(saltJoao + ':123456');

      usuarios = [
        { id: 1, nome: 'Administrador', email: 'admin@engepro.com', salt: saltAdmin, passwordHash: hashAdmin, perfil: 'Administrador', ativo: true, avatar: 'AD' },
        { id: 2, nome: 'João da Silva', email: 'joao@engepro.com', salt: saltJoao, passwordHash: hashJoao, perfil: 'Operador', ativo: true, avatar: 'JS' }
      ];
      this.set('usuarios', usuarios);
    } else {
      let updated = false;
      usuarios = usuarios.map(u => {
        if (u.senha && !u.passwordHash) {
          const salt = Security.generateSalt(16);
          const hash = Security.sha256Sync(salt + ':' + u.senha);
          const { senha, ...cleanUser } = u;
          updated = true;
          return { ...cleanUser, salt, passwordHash: hash };
        }
        return u;
      });
      if (updated) {
        this.set('usuarios', usuarios);
        Security.logAudit('SISTEMA_MIGRACAO_SENHAS', 'Migração de senhas para SHA-256 com salt concluída.', 'SUCCESS');
      }
    }

    // 2. Inicialização de Categorias
    if (!localStorage.getItem('ep_categorias')) {
      this.set('categorias', [
        'Matéria-prima', 'Componentes', 'Embalagem', 'Material de Consumo', 'EPI', 'Elétrica', 'Hidráulica', 'Outros'
      ]);
    }

    // 3. Inicialização de Produtos
    if (!localStorage.getItem('ep_produtos')) {
      this.set('produtos', [
        { id: 'MP-0001', nome: 'Tubo de Aço 1"', desc: 'Tubo redondo de aço carbono', categoria: 'Matéria-prima', unidade: 'm', estoqueAtual: 1290, estoqueMin: 500, estoqueMax: 2000, custo: 21.00, fornecedor: 'Metalúrgica São José', local: 'Almoxarifado 01', ativo: true },
        { id: 'MP-0002', nome: 'Chapa de Aço 2mm', desc: 'Chapa lisa de aço carbono', categoria: 'Matéria-prima', unidade: 'kg', estoqueAtual: 800, estoqueMin: 300, estoqueMax: 1500, custo: 9.50, fornecedor: 'Aço Forte Ltda', local: 'Almoxarifado 01', ativo: true },
        { id: 'MP-0003', nome: 'Perfil de Alumínio 20x20', desc: 'Perfil estrutural de alumínio', categoria: 'Matéria-prima', unidade: 'm', estoqueAtual: 100, estoqueMin: 200, estoqueMax: 800, custo: 35.00, fornecedor: 'Metalúrgica São José', local: 'Almoxarifado 02', ativo: true },
        { id: 'EMB-0001', nome: 'Caixa de Papelão M', desc: 'Caixa 30x20x15cm', categoria: 'Embalagem', unidade: 'un', estoqueAtual: 950, estoqueMin: 400, estoqueMax: 1200, custo: 2.50, fornecedor: 'Embalagens Brasil', local: 'Galpão B', ativo: true },
        { id: 'EMB-0002', nome: 'Fita Adesiva Transparente', desc: 'Fita 48mm x 50m', categoria: 'Embalagem', unidade: 'un', estoqueAtual: 75, estoqueMin: 100, estoqueMax: 500, custo: 4.80, fornecedor: 'Embalagens Brasil', local: 'Galpão B', ativo: true },
        { id: 'COMP-0001', nome: 'Parafuso Sextavado M8', desc: 'Aço zincado', categoria: 'Componentes', unidade: 'un', estoqueAtual: 0, estoqueMin: 100, estoqueMax: 600, custo: 0.45, fornecedor: 'Parafusos Brasil', local: 'Almoxarifado 01', ativo: true },
        { id: 'COMP-0002', nome: 'Porca Sextavada M8', desc: 'Aço zincado', categoria: 'Componentes', unidade: 'un', estoqueAtual: 320, estoqueMin: 200, estoqueMax: 800, custo: 0.35, fornecedor: 'Parafusos Brasil', local: 'Almoxarifado 01', ativo: true },
        { id: 'QUIM-0001', nome: 'Óleo Lubrificante 68', desc: 'Óleo mineral ISO VG 68', categoria: 'Material de Consumo', unidade: 'L', estoqueAtual: 33, estoqueMin: 50, estoqueMax: 200, custo: 18.90, fornecedor: 'LogiSteel Distribuidora', local: 'Almoxarifado 02', ativo: true },
        { id: 'EPI-0001', nome: 'Capacete de Segurança', desc: 'Classe B, cor amarela', categoria: 'EPI', unidade: 'un', estoqueAtual: 45, estoqueMin: 20, estoqueMax: 100, custo: 28.00, fornecedor: 'Tradição Representações', local: 'Almoxarifado 03', ativo: true },
        { id: 'EPI-0002', nome: 'Luva de Raspa', desc: 'Tamanho único', categoria: 'EPI', unidade: 'par', estoqueAtual: 120, estoqueMin: 50, estoqueMax: 300, custo: 12.50, fornecedor: 'Tradição Representações', local: 'Almoxarifado 03', ativo: true }
      ]);
    }

    // 4. Inicialização de Movimentações
    if (!localStorage.getItem('ep_movimentacoes')) {
      const buildMovements = () => {
        const list = [];
        let id = 1;
        const sampleProducts = [
          { id: 'MP-0001', name: 'Tubo de Aço 1"' },
          { id: 'MP-0002', name: 'Chapa de Aço 2mm' },
          { id: 'EMB-0001', name: 'Caixa de Papelão M' },
          { id: 'COMP-0002', name: 'Porca Sextavada M8' },
          { id: 'EPI-0001', name: 'Capacete de Segurança' },
          { id: 'EPI-0002', name: 'Luva de Raspa' }
        ];

        const dateConfigs = [
          { dateStr: '2026-08-05T10:00:00', ent: 5, sai: 2, aju: 1 },
          { dateStr: '2026-08-08T14:30:00', ent: 0, sai: 30, aju: 0 },
          { dateStr: '2026-08-09T09:15:00', ent: 1, sai: 5, aju: 30 },
          { dateStr: '2026-08-10T11:45:00', ent: 45, sai: 0, aju: 12 },
          { dateStr: '2026-08-11T16:20:00', ent: 12, sai: 18, aju: 2 },
          { dateStr: '2026-08-13T08:50:00', ent: 3, sai: 25, aju: 0 },
          { dateStr: '2026-08-15T15:10:00', ent: 50, sai: 8, aju: 5 },
          { dateStr: '2026-08-17T13:40:00', ent: 0, sai: 15, aju: 22 },
          { dateStr: '2026-08-19T10:05:00', ent: 28, sai: 3, aju: 0 },
          { dateStr: '2026-08-20T17:00:00', ent: 8, sai: 32, aju: 4 }
        ];

        dateConfigs.forEach((config, index) => {
          const p1 = sampleProducts[index % sampleProducts.length];
          const p2 = sampleProducts[(index + 1) % sampleProducts.length];

          if (config.ent > 0) {
            list.push({
              id: id++,
              data: config.dateStr,
              tipo: 'Entrada',
              produtoId: p1.id,
              produto: p1.name,
              quantidade: config.ent,
              saldoApos: 1200 + config.ent,
              local: 'Almoxarifado 01',
              responsavel: 'Carlos Pereira',
              descricao: 'Recebimento de compra - NF ' + (12500 + index)
            });
          }

          if (config.sai > 0) {
            list.push({
              id: id++,
              data: config.dateStr,
              tipo: 'Saída',
              produtoId: p2.id,
              produto: p2.name,
              quantidade: -config.sai,
              saldoApos: 800 - config.sai,
              local: 'Produção',
              responsavel: 'João da Silva',
              descricao: 'Ordem de Produção #' + (3500 + index)
            });
          }

          if (config.aju !== 0) {
            list.push({
              id: id++,
              data: config.dateStr,
              tipo: 'Ajuste',
              produtoId: p1.id,
              produto: p1.name,
              quantidade: config.aju,
              saldoApos: 1200 + config.ent + config.aju,
              local: 'Almoxarifado 01',
              responsavel: 'Maria Oliveira',
              descricao: 'Ajuste de conferência física'
            });
          }
        });

        return list;
      };

      this.set('movimentacoes', buildMovements());
    }

    // 5. Inicialização de Fornecedores
    if (!localStorage.getItem('ep_fornecedores')) {
      this.set('fornecedores', [
        { id: 1, nome: 'Metalúrgica São José', cnpj: '05.123.456/0001-10', categoria: 'Metalúrgicos', avaliacao: 4.9, entregasPrazo: 96, qualidade: 98, ultimaCompra: '2024-05-24', situacao: 'Aprovado', totalCompras: 128450 },
        { id: 2, nome: 'Aço Forte Ltda', cnpj: '12.987.654/0001-20', categoria: 'Siderúrgicos', avaliacao: 4.2, entregasPrazo: 89, qualidade: 92, ultimaCompra: '2024-05-20', situacao: 'Aprovado', totalCompras: 96230 },
        { id: 3, nome: 'Parafusos Brasil', cnpj: '08.765.432/0001-30', categoria: 'Componentes', avaliacao: 4.0, entregasPrazo: 85, qualidade: 90, ultimaCompra: '2024-05-18', situacao: 'Aprovado', totalCompras: 54780 },
        { id: 4, nome: 'Tradição Representações', cnpj: '21.345.678/0001-40', categoria: 'Elétricos', avaliacao: 3.2, entregasPrazo: 75, qualidade: 70, ultimaCompra: '2024-05-10', situacao: 'Em avaliação', totalCompras: 28360 },
        { id: 5, nome: 'LogiSteel Distribuidora', cnpj: '31.456.789/0001-50', categoria: 'Siderúrgicos', avaliacao: 3.0, entregasPrazo: 68, qualidade: 65, ultimaCompra: '2024-05-05', situacao: 'Em avaliação', totalCompras: 42910 }
      ]);
    }

    // 6. Inicialização de Auditoria
    if (!localStorage.getItem('ep_audit_log')) {
      this.set('audit_log', [
        {
          id: 'init-001',
          timestamp: new Date().toISOString(),
          actorName: 'Sistema',
          actorEmail: 'sistema@engepro.com',
          actorPerfil: 'Sistema',
          action: 'SISTEMA_INICIALIZADO',
          details: 'Inicialização do banco de dados local com proteção criptográfica e motor anti-SQL Injection ativados.',
          status: 'SUCCESS',
          userAgent: 'Interno'
        }
      ]);
    }
  },

  // Recuperação de dados segura com defesa contra Prototype Pollution
  get(key) {
    try {
      const cleanKey = String(key).replace(/[^a-zA-Z0-9_]/g, '');
      const raw = localStorage.getItem('ep_' + cleanKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(item => {
          if (typeof item === 'object' && item !== null) {
            const cleanObj = Object.create(null);
            for (const k of Object.keys(item)) {
              if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
                cleanObj[k] = item[k];
              }
            }
            return cleanObj;
          }
          return item;
        });
      }
      if (typeof parsed === 'object' && parsed !== null) {
        const cleanObj = Object.create(null);
        for (const k of Object.keys(parsed)) {
          if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
            cleanObj[k] = parsed[k];
          }
        }
        return cleanObj;
      }
      return parsed;
    } catch {
      return [];
    }
  },

  // Persistência segura
  set(key, val) {
    const cleanKey = String(key).replace(/[^a-zA-Z0-9_]/g, '');
    localStorage.setItem('ep_' + cleanKey, JSON.stringify(val));
  },

  nextId(key) {
    const arr = this.get(key);
    if (!Array.isArray(arr) || !arr.length) return 1;
    const nums = arr.map(x => Number(x.id)).filter(n => Number.isFinite(n));
    return nums.length ? Math.max(...nums) + 1 : 1;
  },

  getUser(email) {
    if (!email) return null;
    const cleanEmail = Security.sanitizeText(email, 100).toLowerCase();
    if (Security.detectSqlInjection(cleanEmail)) {
      Security.logAudit('SQL_INJECTION_DETECTADA', `Tentativa de SQL Injection no login: ${cleanEmail}`, 'CRITICAL');
      return null;
    }
    return this.get('usuarios').find(u => String(u.email || '').toLowerCase() === cleanEmail) || null;
  },

  // ===== CONSULTAS SQL PARAMETRIZADAS SEGURAS =====
  query(sql, params = []) {
    try {
      const compiled = Security.compilePreparedStatement(sql, params);
      const selectMatch = compiled.match(/^\s*SELECT\s+(.+?)\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?(?:\s+OFFSET\s+(\d+))?\s*$/i);
      
      if (selectMatch) {
        const [, fields, table, where, orderBy, limit, offset] = selectMatch;
        let data = this.get(table);
        
        if (where) {
          data = data.filter(row => this.evaluateSafeCondition(row, where));
        }
        
        if (orderBy) {
          const [col, dir] = orderBy.trim().split(/\s+/);
          const cleanCol = col.replace(/["'`]/g, '');
          const isDesc = String(dir || '').toUpperCase() === 'DESC';
          data.sort((a, b) => {
            const va = a[cleanCol], vb = b[cleanCol];
            if (va < vb) return isDesc ? 1 : -1;
            if (va > vb) return isDesc ? -1 : 1;
            return 0;
          });
        }
        
        const off = Number(offset) || 0;
        const lim = Number(limit) || data.length;
        return data.slice(off, off + lim);
      }
      
      return [];
    } catch (err) {
      console.error('Erro na execução SQL:', err);
      Security.logAudit('SQL_EXECUTION_ERROR', `Erro SQL: ${err.message}`, 'WARNING');
      return [];
    }
  },

  evaluateSafeCondition(row, whereStr) {
    if (!whereStr || whereStr.trim() === '1=1') return true;
    const parts = whereStr.split(/\s+AND\s+/i);
    return parts.every(part => {
      const match = part.match(/^\s*([a-zA-Z0-9_]+)\s*(=|!=|<>|>|<|>=|<=|LIKE)\s*(.+?)\s*$/i);
      if (!match) return true;
      const [, col, op, rawVal] = match;
      const rowVal = row[col];
      let val = rawVal.trim();
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1).replace(/''/g, "'");
      else if (!isNaN(Number(val))) val = Number(val);
      
      if (op === '=' || op === '==') return String(rowVal) === String(val);
      if (op === '!=' || op === '<>') return String(rowVal) !== String(val);
      if (op === '>') return Number(rowVal) > Number(val);
      if (op === '<') return Number(rowVal) < Number(val);
      if (op === '>=') return Number(rowVal) >= Number(val);
      if (op === '<=') return Number(rowVal) <= Number(val);
      if (op.toUpperCase() === 'LIKE') {
        const pattern = String(val).replace(/%/g, '.*').replace(/_/g, '.');
        return new RegExp(`^${pattern}$`, 'i').test(String(rowVal || ''));
      }
      return true;
    });
  },

  select(table, conditions = {}, options = {}) {
    const cleanTable = Security.escapeSqlIdentifier(table).replace(/"/g, '');
    let records = this.get(cleanTable);
    
    if (conditions && typeof conditions === 'object') {
      records = records.filter(item => {
        return Object.entries(conditions).every(([key, val]) => {
          if (val === undefined) return true;
          return item[key] === Security.validateSqlParam(val);
        });
      });
    }
    
    return records;
  },

  insert(table, data) {
    const cleanTable = Security.escapeSqlIdentifier(table).replace(/"/g, '');
    const cleanData = {};
    for (const [k, v] of Object.entries(data)) {
      if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
        cleanData[k] = Security.validateSqlParam(v);
      }
    }
    const items = this.get(cleanTable);
    items.unshift(cleanData);
    this.set(cleanTable, items);
    return cleanData;
  },

  update(table, id, data) {
    const cleanTable = Security.escapeSqlIdentifier(table).replace(/"/g, '');
    const safeId = Security.validateSqlParam(id);
    const items = this.get(cleanTable);
    const idx = items.findIndex(x => x.id === safeId);
    if (idx < 0) return null;
    
    for (const [k, v] of Object.entries(data)) {
      if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
        items[idx][k] = Security.validateSqlParam(v);
      }
    }
    this.set(cleanTable, items);
    return items[idx];
  },

  delete(table, id) {
    const cleanTable = Security.escapeSqlIdentifier(table).replace(/"/g, '');
    const safeId = Security.validateSqlParam(id);
    const items = this.get(cleanTable);
    const filtered = items.filter(x => x.id !== safeId);
    this.set(cleanTable, filtered);
    return true;
  }
};

// Inicializa a base
DB.init();
