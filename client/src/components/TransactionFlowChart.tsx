import { motion, AnimatePresence } from 'framer-motion';
import {
  Sankey,
  Rectangle,
  Layer,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TokenTransaction } from '@/hooks/use-tokens';
import { useMemo } from 'react';

interface Node {
  name: string;
  value: number;
  fill?: string;
}

interface Link {
  source: number;
  target: number;
  value: number;
  type: TokenTransaction['type'];
}

interface TransactionFlowChartProps {
  transactions: TokenTransaction[];
  height?: number;
}

export function TransactionFlowChart({ transactions, height = 400 }: TransactionFlowChartProps) {
  const { nodes, links } = useMemo(() => {
    // Create unique nodes from transaction addresses
    const uniqueAddresses = new Set<string>();
    transactions.forEach(tx => {
      if (tx.fromAddress) uniqueAddresses.add(tx.fromAddress);
      if (tx.toAddress) uniqueAddresses.add(tx.toAddress);
    });

    const addressToIndex = new Map<string, number>();
    const nodes: Node[] = Array.from(uniqueAddresses).map((address, index) => {
      addressToIndex.set(address, index);
      return {
        name: address === 'SYSTEM' ? 'Token Minting' : 
              address === 'ESCROW' ? 'Escrow' : 
              `User: ${address}`,
        value: 0,
        fill: address === 'SYSTEM' ? '#22c55e' : 
              address === 'ESCROW' ? '#f59e0b' : 
              '#3b82f6'
      };
    });

    // Create links from transactions
    const links: Link[] = transactions.map(tx => ({
      source: addressToIndex.get(tx.fromAddress || 'SYSTEM') || 0,
      target: addressToIndex.get(tx.toAddress || '') || 0,
      value: tx.amount,
      type: tx.type
    }));

    return { nodes, links };
  }, [transactions]);

  if (!transactions.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Token Flow Visualization</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[400px] text-muted-foreground">
          No transactions to display
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Flow Visualization</CardTitle>
      </CardHeader>
      <CardContent>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="w-full"
          style={{ height }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={{ nodes, links }}
              node={({ x, y, width, height, index, payload }) => (
                <motion.g
                  initial={{ opacity: 0, y: y + 10 }}
                  animate={{ opacity: 1, y }}
                  transition={{ delay: index * 0.1 }}
                >
                  <Rectangle
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill={payload.fill || '#3b82f6'}
                    fillOpacity={0.9}
                  />
                  <text
                    x={x + width / 2}
                    y={y + height / 2}
                    textAnchor="middle"
                    alignmentBaseline="middle"
                    fill="#fff"
                    fontSize={12}
                  >
                    {payload.name}
                  </text>
                </motion.g>
              )}
              link={({ sourceX, sourceY, targetX, targetY, linkWidth, index, payload }) => (
                <motion.path
                  initial={{ opacity: 0, pathLength: 0 }}
                  animate={{ opacity: 0.4, pathLength: 1 }}
                  transition={{ delay: index * 0.1, duration: 0.5 }}
                  d={`
                    M${sourceX},${sourceY + linkWidth / 2}
                    C${(sourceX + targetX) / 2},${sourceY + linkWidth / 2}
                     ${(sourceX + targetX) / 2},${targetY + linkWidth / 2}
                     ${targetX},${targetY + linkWidth / 2}
                  `}
                  fill="none"
                  stroke={
                    payload.type === 'purchase' ? '#22c55e' :
                    payload.type === 'escrow' ? '#f59e0b' :
                    payload.type === 'release' ? '#3b82f6' :
                    '#ef4444'
                  }
                  strokeWidth={linkWidth}
                />
              )}
              margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
              nodeWidth={100}
              nodePadding={50}
            >
              <Tooltip
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const data = payload[0].payload;
                  return (
                    <div className="bg-background border rounded-lg p-2 shadow-lg">
                      <p className="font-medium">{data.payload.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {data.value} tokens
                      </p>
                    </div>
                  );
                }}
              />
            </Sankey>
          </ResponsiveContainer>
        </motion.div>
      </CardContent>
    </Card>
  );
}
