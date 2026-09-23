import type { Product, ProductInput } from '@/types/product';

// Deklarasikan fungsi server yang boleh dipanggil dari frontend.
type GasFunctions = {
  getProducts: () => Product[];
  getProductById: (id: string) => Product | null;
  saveProduct: (input: ProductInput) => { id: string };
};

type GasRunner = {
  withSuccessHandler(callback: (value: unknown) => void): GasRunner;
  withFailureHandler(callback: (error: Error) => void): GasRunner;
  [method: string]: unknown;
};

// Pakai deklarasi ini jika project-mu belum memiliki tipe untuk google.script.run.
declare const google: { script: { run: GasRunner } };

export function runGas<K extends keyof GasFunctions>(
  name: K,
  ...args: Parameters<GasFunctions[K]>
): Promise<Awaited<ReturnType<GasFunctions[K]>>> {
  return new Promise((resolve, reject) => {
    const runner = google.script.run
      .withSuccessHandler((result: unknown) => {
        resolve(result as Awaited<ReturnType<GasFunctions[K]>>);
      })
      .withFailureHandler(reject);

    const method = runner[name];

    if (typeof method !== 'function') {
      reject(new Error(`Fungsi Apps Script "${String(name)}" tidak ditemukan`));
      return;
    }

    try {
      method.apply(runner, args);
    } catch (error) {
      reject(error);
    }
  });
}
