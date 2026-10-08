import { runGas } from '@/lib/gas';
import { useQuery } from '@tanstack/react-query';

export const useGetProducts = () => {
  return useQuery({
    queryKey: ['products'],
    queryFn: () => runGas('getProducts'),
  });
};
