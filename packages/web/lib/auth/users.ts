/**
 * User Management
 * ===============
 * Simple user storage and management (can be replaced with database later)
 */

import { UserRole, UserSession } from '../middleware/auth';
import { generateToken } from '../middleware/auth';

/**
 * User model
 */
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string; // In production, use bcrypt
  createdAt: Date;
  lastLogin?: Date;
}

/**
 * In-memory user store (replace with database in production)
 */
class UserStore {
  private users: Map<string, User> = new Map();
  private usersByEmail: Map<string, User> = new Map();

  /**
   * Create a new user
   */
  async createUser(
    email: string,
    password: string,
    name: string,
    role: UserRole = UserRole.USER
  ): Promise<User> {
    // Check if user already exists
    if (this.usersByEmail.has(email.toLowerCase())) {
      throw new Error('User with this email already exists');
    }

    const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // In production, hash password with bcrypt
    // For now, simple hash (NOT SECURE - replace with bcrypt)
    const passwordHash = Buffer.from(password).toString('base64');

    const user: User = {
      id,
      email: email.toLowerCase(),
      name,
      role,
      passwordHash,
      createdAt: new Date(),
    };

    this.users.set(id, user);
    this.usersByEmail.set(email.toLowerCase(), user);

    return user;
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.usersByEmail.get(email.toLowerCase()) || null;
  }

  /**
   * Verify password
   */
  async verifyPassword(user: User, password: string): Promise<boolean> {
    // In production, use bcrypt.compare
    const passwordHash = Buffer.from(password).toString('base64');
    return passwordHash === user.passwordHash;
  }

  /**
   * Update user last login
   */
  async updateLastLogin(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.lastLogin = new Date();
    }
  }

  /**
   * List all users (admin only)
   */
  async listUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (user) {
      this.users.delete(userId);
      this.usersByEmail.delete(user.email);
      return true;
    }
    return false;
  }
}

// Singleton instance
export const userStore = new UserStore();

/**
 * Authenticate user and generate token
 */
export async function authenticateUser(
  email: string,
  password: string
): Promise<{ token: string; user: UserSession }> {
  const user = await userStore.findByEmail(email);
  
  if (!user) {
    throw new Error('Invalid email or password');
  }

  const isValid = await userStore.verifyPassword(user, password);
  if (!isValid) {
    throw new Error('Invalid email or password');
  }

  await userStore.updateLastLogin(user.id);

  const session: UserSession = {
    userId: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
  };

  const token = await generateToken(session);

  return { token, user: session };
}

/**
 * Create default admin user if none exists
 */
export async function initializeDefaultUser(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@quantbot.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';

  const existing = await userStore.findByEmail(adminEmail);
  if (!existing) {
    await userStore.createUser(adminEmail, adminPassword, 'Admin', UserRole.ADMIN);
    console.log('Default admin user created:', adminEmail);
  }
}

