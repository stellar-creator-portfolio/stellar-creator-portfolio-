import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as snarkjs from 'snarkjs';
import fs from 'fs/promises';
import path from 'path';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { proof, publicSignals, nullifier, rating, subjectId } = body;

    if (!proof || !publicSignals || !nullifier) {
      return NextResponse.json({ error: 'Missing proof data' }, { status: 400 });
    }

    // Load verification key
    const vkeyPath = path.join(process.cwd(), 'public', 'wasm', 'vkey.json');
    let vkeyJson;
    try {
      vkeyJson = await fs.readFile(vkeyPath, 'utf8');
    } catch (err) {
      return NextResponse.json({ error: 'Verification key not found on server' }, { status: 500 });
    }
    const vkey = JSON.parse(vkeyJson);

    // Verify cryptographic proof
    const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid ZK proof' }, { status: 400 });
    }

    // Enforce nullifier uniqueness server-side
    // Using string matching for the nullifier to prevent double-spending the credential for this creator
    const existingReview = await prisma.review.findUnique({
      where: { nullifier },
    });

    if (existingReview) {
      return NextResponse.json({ error: 'Nullifier already used' }, { status: 409 });
    }

    return NextResponse.json({ success: true, message: 'Proof verified and nullifier is unique' }, { status: 200 });
  } catch (error) {
    console.error('Verify proof error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
