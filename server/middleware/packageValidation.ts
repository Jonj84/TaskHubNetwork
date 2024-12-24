import { Request, Response, NextFunction } from 'express';
import { db } from '@db';
import { tokenPackages } from '@db/schema';
import { validateTokenPackage } from '../utils/validation';

export async function validatePackageMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const packageData = req.body;

    // Get existing packages for comparison
    const existingPackages = await db
      .select()
      .from(tokenPackages)
      .where(pkg => 
        // Exclude current package when updating
        packageData.id ? pkg.id !== packageData.id : true
      );

    const { isValid, errors } = await validateTokenPackage(packageData, existingPackages);

    if (!isValid) {
      return res.status(400).json({
        message: 'Invalid token package',
        errors,
      });
    }

    next();
  } catch (error) {
    console.error('Package validation error:', error);
    res.status(500).json({
      message: 'Failed to validate package',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
