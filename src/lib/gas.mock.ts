import { createProduct } from '@/mocks/product';
import type { GasFunctions } from '../../shared/contracts';

export const gasMock: GasFunctions = {
  getProducts: () => Array.from({ length: 10 }).map(createProduct),
};
