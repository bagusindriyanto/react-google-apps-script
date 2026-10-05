import type { GasFunctions } from '../../shared/contracts';

type GasRunner = {
  withSuccessHandler(callback: (value: unknown) => void): GasRunner;
  withFailureHandler(callback: (error: Error) => void): GasRunner;
  [method: string]: unknown;
};

// Pakai deklarasi ini jika project-mu belum memiliki tipe untuk google.script.run.
declare const google: { script?: { run?: GasRunner } } | undefined;

export function runGas<K extends keyof GasFunctions>(
  name: K,
  ...args: Parameters<GasFunctions[K]>
): Promise<Awaited<ReturnType<GasFunctions[K]>>> {
  return new Promise((resolve, reject) => {
    const bridge = typeof google === 'undefined' ? undefined : google?.script?.run;

    if (!bridge) {
      if (import.meta.env.DEV) {
        import('./gas.mock')
          .then(({ gasMock }) => {
            const method = gasMock[name] as GasFunctions[K];
            resolve(method.apply(gasMock, args) as Awaited<ReturnType<GasFunctions[K]>>);
          })
          .catch(reject);
      } else {
        reject(new Error('google.script.run tidak tersedia. Buka aplikasi melalui web app Google Apps Script.'));
      }
      return;
    }

    const runner = bridge
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
