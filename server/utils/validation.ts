import { z } from 'zod';
import type { TokenPackage } from '@db/schema';

// Constants for validation
export const PACKAGE_CONSTRAINTS = {
  MIN_TOKENS: 100,
  MAX_TOKENS: 1000000,
  MIN_PRICE_CENTS: 100, // $1.00
  MAX_PRICE_CENTS: 1000000, // $10,000.00
  MIN_FEATURES: 1,
  MAX_FEATURES: 10,
};

// Enhanced schema for token package validation
export const tokenPackageValidationSchema = z.object({
  name: z.string()
    .min(3, "Package name must be at least 3 characters")
    .max(50, "Package name cannot exceed 50 characters"),
  description: z.string()
    .min(10, "Description must be at least 10 characters")
    .max(200, "Description cannot exceed 200 characters"),
  tokenAmount: z.number()
    .int()
    .min(PACKAGE_CONSTRAINTS.MIN_TOKENS, `Minimum tokens allowed is ${PACKAGE_CONSTRAINTS.MIN_TOKENS}`)
    .max(PACKAGE_CONSTRAINTS.MAX_TOKENS, `Maximum tokens allowed is ${PACKAGE_CONSTRAINTS.MAX_TOKENS}`),
  price: z.number()
    .int()
    .min(PACKAGE_CONSTRAINTS.MIN_PRICE_CENTS, "Minimum price is $1.00")
    .max(PACKAGE_CONSTRAINTS.MAX_PRICE_CENTS, "Maximum price is $10,000.00"),
  features: z.array(z.string())
    .min(PACKAGE_CONSTRAINTS.MIN_FEATURES, "At least one feature is required")
    .max(PACKAGE_CONSTRAINTS.MAX_FEATURES, "Maximum 10 features allowed"),
  isPopular: z.boolean().optional(),
});

// Validation function for token packages
export async function validateTokenPackage(
  package_: Partial<TokenPackage>,
  existingPackages?: TokenPackage[]
): Promise<{ isValid: boolean; errors: string[] }> {
  const errors: string[] = [];

  try {
    // Basic schema validation
    tokenPackageValidationSchema.parse(package_);

    if (existingPackages?.length) {
      // Validate price tiers
      const pricePerToken = package_.price! / package_.tokenAmount!;
      
      // Check if the price per token is reasonable compared to other packages
      existingPackages.forEach(existingPkg => {
        const existingPricePerToken = existingPkg.price / existingPkg.tokenAmount;
        
        if (package_.tokenAmount! > existingPkg.tokenAmount && 
            pricePerToken >= existingPricePerToken) {
          errors.push(
            `Price per token (${pricePerToken.toFixed(4)}) should be lower than the ${
              existingPkg.name
            } package (${existingPricePerToken.toFixed(4)}) since it offers more tokens`
          );
        }
      });

      // Check for duplicate names
      if (existingPackages.some(p => 
        p.id !== package_.id && 
        p.name.toLowerCase() === package_.name?.toLowerCase()
      )) {
        errors.push("Package name must be unique");
      }
    }

    // Validate features
    const features = package_.features as string[];
    if (features.some(f => f.length < 3)) {
      errors.push("Each feature must be at least 3 characters long");
    }
    if (features.some(f => f.length > 100)) {
      errors.push("Each feature must not exceed 100 characters");
    }
    if (new Set(features).size !== features.length) {
      errors.push("Features must be unique");
    }

  } catch (error) {
    if (error instanceof z.ZodError) {
      errors.push(...error.errors.map(e => e.message));
    } else {
      errors.push("Invalid package data");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// Helper to check if a package's price tier makes sense
export function validatePriceTier(
  tokenAmount: number,
  price: number,
  existingPackages: TokenPackage[]
): boolean {
  const pricePerToken = price / tokenAmount;
  
  // Sort packages by token amount
  const sortedPackages = [...existingPackages].sort((a, b) => a.tokenAmount - b.tokenAmount);
  
  // Find the nearest lower and higher packages
  const lowerPackage = sortedPackages.find(p => p.tokenAmount < tokenAmount);
  const higherPackage = sortedPackages.find(p => p.tokenAmount > tokenAmount);
  
  if (lowerPackage) {
    const lowerPricePerToken = lowerPackage.price / lowerPackage.tokenAmount;
    if (pricePerToken >= lowerPricePerToken) {
      return false; // Should offer better value than lower tier
    }
  }
  
  if (higherPackage) {
    const higherPricePerToken = higherPackage.price / higherPackage.tokenAmount;
    if (pricePerToken <= higherPricePerToken) {
      return false; // Should offer less value than higher tier
    }
  }
  
  return true;
}
