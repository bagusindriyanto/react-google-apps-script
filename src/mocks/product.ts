import { faker } from '@faker-js/faker';
import type { Product } from '@/types/product';

export const createProduct = (): Product => {
  return {
    id: faker.string.uuid(),
    name: faker.commerce.productName(),
  };
};
