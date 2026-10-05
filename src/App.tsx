import { useEffect, useState } from 'react';
import { runGas } from '@/lib/gas';
import type { Product } from '@/types/product';

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;

    runGas('getProducts')
      .then((result) => {
        if (!cancelled) setProducts(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [reload]);

  function loadAgain() {
    setLoading(true);
    setError('');
    setReload((value) => value + 1);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-900">
      <section className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">React + Google Apps Script</h1>
        <h2 className="mt-8 text-lg font-semibold">Daftar produk</h2>
        <div className="mt-4" aria-live="polite" aria-busy={loading}>
          {loading ? (
            <p className="text-slate-500" role="status">Memuat produk…</p>
          ) : error ? (
            <p className="text-red-700" role="alert">{error}</p>
          ) : products.length ? (
            <ul className="divide-y divide-slate-100">
              {products.map((product) => <li className="py-3" key={product.id}>{product.name}</li>)}
            </ul>
          ) : <p className="text-slate-500">Belum ada produk.</p>}
        </div>
        <button
          className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          onClick={loadAgain}
          disabled={loading}
        >
          Muat ulang
        </button>
      </section>
    </main>
  );
}

export default App;
