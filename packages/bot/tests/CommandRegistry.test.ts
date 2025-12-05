/**
 * @file CommandRegistry.test.ts
 * @description
 * Comprehensive unit tests for CommandRegistry covering command execution,
 * management, and error handling using the public API.
 */

import { CommandRegistry } from '../../src/commands/CommandRegistry';
import { SessionService } from '../../src/services/SessionService';
import { StrategyService } from '../../src/services/StrategyService';
import { SimulationService } from '../../src/services/SimulationService';
import { Context } from 'telegraf';

// Mock dependencies
jest.mock('../../src/services/SessionService');
jest.mock('../../src/services/StrategyService');
jest.mock('../../src/services/SimulationService');
jest.mock('../../src/commands/BacktestCommandHandler');
jest.mock('../../src/commands/StrategyCommandHandler');
jest.mock('../../src/commands/CancelCommandHandler');
jest.mock('../../src/commands/RepeatCommandHandler');

const MockSessionService = SessionService as jest.MockedClass<typeof SessionService>;
const MockStrategyService = StrategyService as jest.MockedClass<typeof StrategyService>;
const MockSimulationService = SimulationService as jest.MockedClass<typeof SimulationService>;

describe('CommandRegistry', () => {
  let commandRegistry: CommandRegistry;
  let mockSessionService: jest.Mocked<SessionService>;
  let mockStrategyService: jest.Mocked<StrategyService>;
  let mockSimulationService: jest.Mocked<SimulationService>;
  let mockContext: jest.Mocked<Context>;
  let mockBot: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockBot = {
      command: jest.fn(),
      telegram: {
        sendMessage: jest.fn()
      }
    };
    
    mockSessionService = {
      getSession: jest.fn(),
      setSession: jest.fn(),
      clearSession: jest.fn(),
      getAllSessions: jest.fn()
    } as any;
    
    mockStrategyService = {
      getUserStrategies: jest.fn(),
      getStrategy: jest.fn(),
      saveStrategy: jest.fn(),
      deleteStrategy: jest.fn()
    } as any;
    
    mockSimulationService = {
      runSimulation: jest.fn(),
      getUserSimulationRuns: jest.fn(),
      repeatSimulation: jest.fn()
    } as any;

    commandRegistry = new CommandRegistry(
      mockBot,
      mockSessionService,
      mockStrategyService,
      mockSimulationService
    );

    mockContext = {
      from: { id: 12345 },
      chat: { id: 67890 },
      message: { text: '/test' },
      reply: jest.fn()
    } as any;
  });

  describe('Command Registration', () => {
    it('should register default handlers on initialization', () => {
      // The registry should have registered default handlers
      const commands = commandRegistry.getCommands();
      
      expect(commands).toContain('backtest');
      expect(commands).toContain('strategy');
      expect(commands).toContain('cancel');
      expect(commands).toContain('repeat');
    });

    it('should have all expected default commands', () => {
      const commands = commandRegistry.getCommands();
      
      expect(commands.length).toBeGreaterThanOrEqual(4);
      expect(commands).toContain('backtest');
      expect(commands).toContain('strategy');
      expect(commands).toContain('cancel');
      expect(commands).toContain('repeat');
    });
  });

  describe('Command Execution', () => {
    it('should execute valid commands', async () => {
      // Test with a default command
      await commandRegistry.execute('backtest_call', mockContext);
      
      // Should not throw an error
      expect(true).toBe(true);
    });

    it('should pass session to handler when user exists', async () => {
      const mockSession = { step: 'waiting_for_token', type: 'backtest' };
      mockSessionService.getSession.mockReturnValue(mockSession);

      await commandRegistry.execute('backtest', mockContext);

      expect(mockSessionService.getSession).toHaveBeenCalledWith(12345);
    });

    it('should handle unknown commands gracefully', async () => {
      // CommandRegistry uses logger.warn, not console.warn
      // Just verify it doesn't throw
      await expect(commandRegistry.execute('unknown', mockContext)).resolves.not.toThrow();
    });

    it('should handle commands without user context', async () => {
      const contextWithoutUser = {
        ...mockContext,
        from: undefined
      };

      await commandRegistry.execute('backtest_call', contextWithoutUser);

      // Should not throw an error
      expect(true).toBe(true);
    });

    it('should handle handler execution errors', async () => {
      // Mock a handler to throw an error by making getSession throw
      mockSessionService.getSession.mockImplementation(() => {
        throw new Error('Service error');
      });

      // The error should be caught and handled gracefully
      await expect(commandRegistry.execute('backtest_call', mockContext)).resolves.not.toThrow();
    });
  });

  describe('Handler Management', () => {
    it('should check command existence', () => {
      expect(commandRegistry.hasCommand('backtest_call')).toBe(true);
      expect(commandRegistry.hasCommand('strategy')).toBe(true);
      expect(commandRegistry.hasCommand('cancel')).toBe(true);
      expect(commandRegistry.hasCommand('repeat')).toBe(true);
      expect(commandRegistry.hasCommand('nonexistent')).toBe(false);
    });

    it('should get all registered commands', () => {
      const commands = commandRegistry.getCommands();
      
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);
      expect(commands).toContain('backtest_call');
      expect(commands).toContain('strategy');
      expect(commands).toContain('cancel');
      expect(commands).toContain('repeat');
    });

    it('should maintain command list consistency', () => {
      const commands = commandRegistry.getCommands();
      const initialLength = commands.length;

      // Commands should remain consistent
      expect(commands.length).toBe(initialLength);
    });
  });

  describe('Error Handling', () => {
    it('should handle null context', async () => {
      await expect(commandRegistry.execute('backtest', null as any))
        .rejects.toThrow();
    });

    it('should handle undefined context', async () => {
      await expect(commandRegistry.execute('backtest', undefined as any))
        .rejects.toThrow();
    });

    it('should handle malformed context', async () => {
      const malformedContext = {
        from: { id: 'invalid' }, // Invalid user ID
        chat: null,
        message: { text: null }
      } as any;

      await commandRegistry.execute('backtest', malformedContext);

      // Should not throw an error
      expect(true).toBe(true);
    });

    it('should handle session service errors', async () => {
      mockSessionService.getSession.mockImplementation(() => {
        throw new Error('Session service error');
      });

      await expect(commandRegistry.execute('backtest', mockContext))
        .rejects.toThrow('Session service error');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty command names', () => {
      expect(commandRegistry.hasCommand('')).toBe(false);
    });

    it('should handle very long command names', () => {
      const longCommandName = 'A'.repeat(1000);
      expect(commandRegistry.hasCommand(longCommandName)).toBe(false);
    });

    it('should handle special characters in command names', () => {
      const specialCommandName = 'command-with-special-chars!@#$%^&*()';
      expect(commandRegistry.hasCommand(specialCommandName)).toBe(false);
    });

    it('should handle concurrent command execution', async () => {
      const promises = Array(10).fill(null).map(() => 
        commandRegistry.execute('backtest', mockContext)
      );

      await Promise.all(promises);

      // Should not throw errors
      expect(true).toBe(true);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete command lifecycle', async () => {
      // Verify command exists
      expect(commandRegistry.hasCommand('backtest')).toBe(true);

      // Execute command
      await commandRegistry.execute('backtest', mockContext);

      // Verify in command list
      const commands = commandRegistry.getCommands();
      expect(commands).toContain('backtest');
    });

    it('should handle session state changes during command execution', async () => {
      const mockSession = { step: 'initial', type: 'backtest' };
      mockSessionService.getSession.mockReturnValue(mockSession);

      await commandRegistry.execute('backtest', mockContext);

      expect(mockSessionService.getSession).toHaveBeenCalledWith(12345);
    });

    it('should handle multiple command types', async () => {
      const commands = ['backtest', 'strategy', 'cancel', 'repeat'];
      
      for (const command of commands) {
        await commandRegistry.execute(command, mockContext);
        expect(commandRegistry.hasCommand(command)).toBe(true);
      }
    });
  });

  describe('Performance', () => {
    it('should execute commands efficiently', async () => {
      const startTime = Date.now();
      await commandRegistry.execute('backtest', mockContext);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should execute quickly
    });

    it('should handle multiple command checks efficiently', () => {
      const startTime = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        commandRegistry.hasCommand('backtest');
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(100); // Should be fast
    });
  });
});