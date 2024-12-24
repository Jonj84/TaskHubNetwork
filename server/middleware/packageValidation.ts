import { Request, Response, NextFunction } from 'express';
import { db } from '@db';
import { tokenPackages } from '@db/schema';
import { validateTokenPackage } from '../utils/validation';
import { eq } from 'drizzle-orm';

export async function validatePackageMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    console.log('Validating package data:', JSON.stringify(req.body, null, 2));
    const packageData = req.body;

    // Get existing packages for comparison
    const existingPackages = await db
      .select()
      .from(tokenPackages)
      .where(
        packageData.id 
          ? eq(tokenPackages.id, packageData.id)
          : undefined
      );

    console.log('Found existing packages:', existingPackages.length);

    const { isValid, errors } = await validateTokenPackage(packageData, existingPackages);
    console.log('Validation result:', { isValid, errors });

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