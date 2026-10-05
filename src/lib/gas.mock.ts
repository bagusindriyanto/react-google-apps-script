import type { GasFunctions } from '../../shared/contracts';

export const gasMock = {
  getProducts: () => [
    { id: '1', name: 'Produk contoh pertama' },
    { id: '2', name: 'Produk contoh kedua' },
  ],
} satisfies GasFunctions;
