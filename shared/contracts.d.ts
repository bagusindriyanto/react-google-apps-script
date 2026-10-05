export type Product = {
  id: string;
  name: string;
};

export type ProductInput = {
  name: string;
};

export type GasFunctions = {
  getProducts: () => Product[];
};
