// In-memory cache of published problems and their tests. Hands are dealt and
// submissions judged from this cache, so the hot path never reads problems from
// the database. The admin reload endpoint calls reload().

function publicView(p, withSamples = true) {
  const d = {
    slug: p.slug, title: p.title, biome: p.biome, rating: p.rating, tier: p.tier,
    statement_md: p.statement_md, input_md: p.input_md, output_md: p.output_md, constraints_md: p.constraints_md,
    time_limit_ms: p.time_limit_ms, memory_mb: p.memory_mb, stubs: p.stubs, tests_total: p.samples.length + p.hidden.length,
  };
  if (withSamples) d.samples = p.samples.map((t) => ({ input: t.input, output: t.expected }));
  return d;
}

export class ProblemCache {
  constructor() {
    this.bySlug = new Map();
    this.byId = new Map();
  }

  /** [{slug, tier, biome}] for dealing decks. */
  get pool() {
    return [...this.bySlug.values()].map((p) => ({ slug: p.slug, tier: p.tier, biome: p.biome }));
  }

  get(slug) {
    return this.bySlug.get(slug) || null;
  }

  static async load(db) {
    const probs = await db.problem.findMany({ where: { status: 'published' } });
    const out = [];
    for (const p of probs) {
      const rows = await db.testCase.findMany({ where: { problem_id: p.id }, orderBy: { idx: 'asc' } });
      const cp = {
        id: p.id, slug: p.slug, title: p.title, biome: p.biome, rating: p.rating, tier: p.tier,
        base_damage: p.base_damage, base_recoil: p.base_recoil, time_limit_ms: p.time_limit_ms, memory_mb: p.memory_mb,
        checker: p.checker, checker_script: p.checker_script, tags: [...(p.tags || [])], hints: [...(p.hints || [])],
        stubs: { ...(p.stubs || {}) }, statement_md: p.statement_md || '', input_md: p.input_md || '',
        output_md: p.output_md || '', constraints_md: p.constraints_md || '', reference_solution: p.reference_solution || '',
        samples: [], hidden: [],
      };
      let si = 0;
      for (const r of rows) if (r.is_sample) cp.samples.push({ index: si++, input: r.input_text, expected: r.expected_text, is_sample: true });
      let hi = 0;
      for (const r of rows) if (!r.is_sample) cp.hidden.push({ index: si + hi++, input: r.input_text, expected: r.expected_text, is_sample: false });
      cp.allTests = [...cp.samples, ...cp.hidden];
      cp.public = (withSamples) => publicView(cp, withSamples);
      cp.summary = () => ({ slug: cp.slug, title: cp.title, biome: cp.biome, tier: cp.tier, rating: cp.rating });
      out.push(cp);
    }
    return out;
  }

  async reload(db) {
    const loaded = await ProblemCache.load(db);
    this.bySlug = new Map(loaded.map((p) => [p.slug, p]));
    this.byId = new Map(loaded.map((p) => [p.id, p]));
  }
}
