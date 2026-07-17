import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

/**
 * Password hashing, isolated behind one service so the algorithm is a single
 * swap point. Uses bcrypt (via the pure-JS `bcryptjs`, avoiding a native build
 * on bleeding-edge Node while remaining bcrypt-compatible).
 */
@Injectable()
export class PasswordService {
  private readonly rounds = 10;

  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }

  async compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
