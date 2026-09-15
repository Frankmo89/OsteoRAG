/**
 * Expansión barata de consultas (sin LLM): sinónimos osteo/KT + parafrasis ES.
 * Mejora recall ante phrasing natural (visceral, TCS, contraindicaciones, lumbar…).
 */

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Stopwords ES (token exacto, Unicode-safe). */
const FILLER_SET = new Set(
  [
    'segun', 'según', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
    'de', 'del', 'al', 'a', 'en', 'por', 'para', 'con', 'sobre',
    'que', 'qué', 'cual', 'cuál', 'cuales', 'cuáles', 'como', 'cómo',
    'donde', 'dónde', 'hay', 'es', 'son', 'ser', 'esta', 'está', 'este',
    'estos', 'estas', 'me', 'te', 'se', 'le', 'les', 'lo', 'mi', 'tu', 'su',
    'nos', 'os', 'puedes', 'puede', 'podrias', 'podrías', 'explica',
    'explícame', 'explicame', 'dime', 'describe', 'resume', 'indica',
    'enumerar', 'enumera', 'lista', 'listar', 'menciona', 'mencioname',
    'cuentame', 'cuéntame', 'aprox', 'aproximadamente', 'realmente',
    'exactamente', 'material', 'corpus', 'libro', 'libros', 'tesis',
    'escuela', 'documento', 'pdf', 'informacion', 'información',
    'pregunta', 'respuesta', 'basado', 'basada', 'basados', 'basadas',
    'aplica', 'aplicacion', 'aplicación', 'region', 'región', 'o', 'u', 'y',
  ].map((w) => stripAccents(w.toLowerCase())),
);

/**
 * Grupos de sinónimos (forma canónica + variantes).
 * Al detectar cualquiera, se generan variantes con las demás.
 */
const SYNONYM_GROUPS: string[][] = [
  [
    'kinesiotape',
    'kinesio tape',
    'kinesiology tape',
    'vendaje neuromuscular',
    'VNM',
    'kinesiotaping',
    'kinesio taping',
    'tape neuromuscular',
    'k-taping',
  ],
  [
    'craneosacral',
    'craneosacro',
    'craniosacral',
    'TCS',
    'terapia craneosacral',
    'secuencia TCS',
    'MRP',
  ],
  [
    'osteopatia visceral',
    'osteopatía visceral',
    'visceral',
    'sistema visceral',
    'órganos viscerales',
  ],
  [
    'contraindicaciones',
    'contraindicacion',
    'contraindicación',
    'contraindicada',
    'contraindicado',
    'no indicado',
  ],
  ['indicaciones', 'indicacion', 'indicación', 'casos indicados'],
  [
    'lumbar',
    'lumbalgia',
    'región lumbar',
    'lumbago',
    'columna lumbar',
    'zona lumbar',
  ],
  ['músculos', 'musculos', 'musculatura', 'grupo muscular'],
  [
    'cervicales',
    'cervical',
    'columna cervical',
    'cuello',
    'región cervical',
    '06_CERVICALES',
  ],
  [
    'disfunción somática',
    'disfuncion somatica',
    'somatic dysfunction',
    'disfunción somática cervical',
  ],
  ['rodilla', 'articulación de la rodilla', 'rodillas'],
  [
    'linfedema',
    'edema linfático',
    'drenaje linfático',
    'drenaje linfatico',
  ],
  ['pelvis', 'pélvica', 'cadera', 'sacroilíaca'],
  ['diafragmas', 'diafragma', 'diafragmático'],
];

/** Frases cortas útiles como consultas alternativas cuando hay match temático. */
const TOPIC_QUERIES: Array<{ test: RegExp; queries: string[] }> = [
  {
    test: /kinesio|vendaje\s*neuro|\bvnm\b|tape|k-taping/i,
    queries: [
      'vendaje neuromuscular VNM kinesiotape definición',
      'indicaciones y contraindicaciones del kinesiotaping',
      'técnica de aplicación kinesiotape',
    ],
  },
  {
    test: /craneosacr|craniosacr|\btcs\b|secuencia\s*tcs|\bmrp\b/i,
    queries: [
      'secuencia TCS tratamiento craneosacral',
      'bases terapia craneosacral MRP diafragmas suturas',
      'Secuencia_TCS osteopatía craneosacral',
    ],
  },
  {
    test: /visceral/i,
    queries: [
      'osteopatía visceral definición',
      'osteopatia visceral sistema musculoesquelético',
      'concepto de visceral en osteopatía',
    ],
  },
  {
    test: /contraindic/i,
    queries: [
      'contraindicaciones absolutas y relativas',
      'indicaciones y contraindicaciones',
    ],
  },
  {
    test: /indicacion/i,
    queries: [
      'indicaciones del tratamiento',
      'indicaciones y contraindicaciones',
    ],
  },
  {
    test: /lumbar|lumbalg|lumbago/i,
    queries: [
      'aplicación kinesiotape lumbalgia técnica en I',
      'vendaje neuromuscular región lumbar',
      'técnica lumbar osteopática',
    ],
  },
  {
    test: /rodilla/i,
    queries: [
      'músculos que actúan sobre la rodilla flexores extensores',
      'anatomía funcional rodilla tobillo pie',
      '08_RODILLA músculos',
    ],
  },
  {
    test: /muscul/i,
    queries: [
      'musculatura anatomía funcional',
      'músculos estriados cuerpo humano',
    ],
  },
  {
    test:
      /disfunci[oó]n\s*som[aá]tic|somatic\s*dysfunction|evaluaci[oó]n\s*osteop/i,
    queries: [
      'disfunción somática cervical evaluación osteopática',
      '06_CERVICALES C1-C2 contraindicaciones manipulación cervical',
      'contraindicaciones técnicas cervicales disfunción somática',
      'evaluación osteopática región cervical',
    ],
  },
  {
    test: /cervic/i,
    queries: [
      '06_CERVICALES técnicas cervicales osteopáticas',
      'contraindicaciones técnicas cervicales',
      'disfunción somática cervical',
      'neuralgia cervicobraquial técnica articulatoria C1-C2',
    ],
  },
  {
    test: /linfedema|drenaje\s*linf/i,
    queries: [
      'linfedema kinesiotape drenaje linfático manual',
      'k-taping drenaje linfático',
      'vendaje neuromuscular linfedema',
      'kinesiology taping teoría y práctica linfedema',
      'rehabilitación fisioterapéutica del linfedema',
    ],
  },
];

function normalizeKey(s: string): string {
  return stripAccents(s.toLowerCase()).replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Quita relleno y signos de puntuación, conserva términos clínicos. */
export function stripFiller(message: string): string {
  const s = message
    .replace(/[¿?¡!.,;:()[\]«»""]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s
    .split(/\s+/)
    .filter((tok) => {
      const key = stripAccents(tok.toLowerCase());
      return key.length > 0 && !FILLER_SET.has(key);
    })
    .join(' ')
    .trim();
}

/**
 * Tokens clínicos distintivos para keyword / hybrid search
 * (longitud ≥ 4, sin filler).
 */
export function clinicalTokens(message: string): string[] {
  const stripped = stripFiller(message);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of stripped.split(/\s+/)) {
    const raw = tok.replace(/[^\p{L}\p{N}_-]/gu, '');
    if (raw.length < 4) continue;
    const key = stripAccents(raw.toLowerCase());
    if (FILLER_SET.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

/**
 * Sustituye coincidencias de un término del grupo por otras variantes
 * (prioridad alta para recall).
 */
function synonymVariants(text: string): string[] {
  const out: string[] = [];
  const folded = stripAccents(text.toLowerCase());

  for (const group of SYNONYM_GROUPS) {
    let matched: string | null = null;
    for (const term of group) {
      const tf = stripAccents(term.toLowerCase());
      if (
        folded.includes(tf) ||
        new RegExp(`\\b${escapeRegExp(tf)}\\b`, 'i').test(folded)
      ) {
        matched = term;
        break;
      }
    }
    if (!matched) continue;

    // Preferir 2–3 alts cortas y clínicas
    const alts = group.filter((a) => normalizeKey(a) !== normalizeKey(matched!)).slice(0, 3);
    for (const alt of alts) {
      const re = new RegExp(escapeRegExp(matched), 'ig');
      if (re.test(text)) {
        re.lastIndex = 0;
        out.push(text.replace(re, alt));
      } else {
        const base = stripFiller(text);
        out.push(base ? `${base} ${alt}` : alt);
      }
    }
  }
  return out;
}

function topicParaphrases(message: string, stripped: string): string[] {
  const out: string[] = [];
  const folded = stripAccents(message);
  for (const { test, queries } of TOPIC_QUERIES) {
    if (test.test(message) || test.test(folded)) {
      out.push(...queries);
    }
  }
  // Prefer paraphrases that overlap more with the stripped clinical terms
  const terms = stripAccents(stripped.toLowerCase())
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const score = (q: string): number => {
    const qf = stripAccents(q.toLowerCase());
    return terms.reduce((n, t) => n + (qf.includes(t) ? 1 : 0), 0);
  };
  return out.sort((a, b) => score(b) - score(a));
}

/**
 * Devuelve la consulta original + 2–4 parafrasis ES (heurísticas).
 * Orden: original → stripped → topics/sinónimos → genéricas.
 * Sin LLM: barato y desplegable en Worker.
 */
/**
 * Corpus 06_CERVICALES no usa heading "contraindicaciones"; el texto habla de
 * "contraindicada la movilización", TEST DE KLEIN / arteria vertebral, etc.
 * Si el mensaje pide cervical + contraindic/precaución/Klein → forzar estas
 * parafrasis ANTES de las genéricas de TOPIC_QUERIES (cap 5).
 */
function cervicalContraindicPriority(message: string): string[] {
  const folded = stripAccents(message.toLowerCase());
  const hasCervical = /cervic|cuello|06_cervicales/.test(folded);
  const hasContra =
    /contraindic|precauci|test\s*de\s*klein|test\s*klein|arteria\s*vertebral/.test(
      folded,
    );
  if (!hasCervical || !hasContra) return [];
  return [
    '06_CERVICALES contraindicada movilización articular',
    'TEST DE KLEIN arteria vertebral cervical',
    'test agujero intervertebral cervical Jackson',
    'contraindicada movilización síntomas neurovegetativos',
  ];
}

export function expandQueries(message: string): string[] {
  const original = message.trim();
  if (!original) return [];

  const stripped = stripFiller(original);
  const priority: string[] = [original];
  if (stripped && normalizeKey(stripped) !== normalizeKey(original)) {
    priority.push(stripped);
  }

  // Forzado: cervical + contraindic / Klein (antes de topics genéricos)
  const forced = cervicalContraindicPriority(original);

  // Alta prioridad: topics + sinónimos (resuelven WEAK/FAIL de EVAL_KATYA)
  const topical: string[] = [
    ...forced,
    ...topicParaphrases(original, stripped || original),
    ...synonymVariants(original),
  ];
  if (stripped) {
    topical.push(...synonymVariants(stripped));
  }

  // Baja prioridad: plantillas genéricas
  const generic: string[] = [];
  if (stripped) {
    generic.push(`definición ${stripped}`);
    generic.push(`técnicas ${stripped}`);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const q of [...priority, ...topical, ...generic]) {
    const t = q.replace(/\s+/g, ' ').trim();
    if (!t || t.length < 3) continue;
    const key = normalizeKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(t);
    if (result.length >= 5) break; // original + hasta 4
  }
  return result;
}
