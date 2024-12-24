import { BlockchainLoader } from "@/components/BlockchainLoader";
import { Card } from "@/components/ui/card";

export default function LoaderDemo() {
  return (
    <div className="container mx-auto p-8">
      <h1 className="text-2xl font-bold mb-8">Blockchain Loading Animations</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <Card className="p-8 flex flex-col items-center gap-4">
          <h2 className="font-semibold">Small</h2>
          <BlockchainLoader size="sm" />
        </Card>

        <Card className="p-8 flex flex-col items-center gap-4">
          <h2 className="font-semibold">Medium</h2>
          <BlockchainLoader size="md" />
        </Card>

        <Card className="p-8 flex flex-col items-center gap-4">
          <h2 className="font-semibold">Large</h2>
          <BlockchainLoader size="lg" />
        </Card>
      </div>
    </div>
  );
}
