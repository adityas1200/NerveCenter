import { tokenize } from './ticket-signature.mjs';

// Ranking behind one small seam, so a semantic (embedding) ranker can replace the word-based one later:
//   ranker.rank({ query: string, documents: [{ id, text }] }) -> Promise<[{ id, score }]>
// best first, only documents that match at all. OperationsService holds `similarityRanker`;
// assign another object with the same `rank` to change how "similar text" is judged.

const K1 = 1.5;
const B = 0.75;

/** BM25 over the documents given (no index kept: the candidate set is a few thousand tickets at most). */
export const bm25Ranker = {
  name: 'bm25',
  async rank({ query, documents }) {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length || !documents.length) return [];
    const docs = documents.map(({ id, text }) => { const words = tokenize(text); const counts = new Map(); for (const word of words) counts.set(word, (counts.get(word) || 0) + 1); return { id, length: words.length, counts }; });
    const average = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1;
    const idf = new Map(terms.map(term => { const n = docs.filter(doc => doc.counts.has(term)).length; return [term, Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))]; }));
    const scored = [];
    for (const doc of docs) {
      let score = 0;
      for (const term of terms) { const tf = doc.counts.get(term); if (tf) score += idf.get(term) * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * doc.length / average)); }
      if (score > 0) scored.push({ id: doc.id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    // A single shared common word is not similarity: keep what is at least a fifth as good as the best match.
    return scored.filter(hit => hit.score >= scored[0].score * 0.2);
  },
};
