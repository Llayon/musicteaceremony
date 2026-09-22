/**
 * Telegram Mini Apps (TMA) Integration Service
 * Provides safe HapticFeedback, viewport expand, and safe area helpers
 */

// Define Telegram WebApp types
export interface TelegramHapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => TelegramHapticFeedback;
  notificationOccurred: (type: 'error' | 'success' | 'warning') => TelegramHapticFeedback;
  selectionChanged: () => TelegramHapticFeedback;
}

export interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  close: () => void;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  headerColor: string;
  backgroundColor: string;
  HapticFeedback: TelegramHapticFeedback;
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  colorScheme: 'light' | 'dark';
  initData: string;
  initDataUnsafe: Record<string, unknown>;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export class TMAService {
  private static isAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean(window.Telegram?.WebApp);
  }

  public static get WebApp(): TelegramWebApp | null {
    if (this.isAvailable() && window.Telegram?.WebApp) {
      return window.Telegram.WebApp;
    }
    return null;
  }

  /**
   * Initializes TMA viewport, expands screen, and prepares safe areas
   */
  public static init(): boolean {
    const webApp = this.WebApp;
    if (!webApp) {
      console.info('[TMA] Telegram WebApp not detected. Running in standard web mode.');
      return false;
    }

    try {
      webApp.ready();
      webApp.expand();
      if (typeof webApp.disableVerticalSwipes === 'function') {
        webApp.disableVerticalSwipes();
      }
      console.info('[TMA] Telegram WebApp initialized & expanded successfully.');
      return true;
    } catch (e) {
      console.warn('[TMA] Error during WebApp initialization:', e);
      return false;
    }
  }

  /**
   * Haptic impact feedback
   * @param style 'light' (PERFECT) | 'soft' (GOOD) | 'medium' | 'heavy' | 'rigid'
   */
  public static hapticImpact(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void {
    const webApp = this.WebApp;
    if (webApp?.HapticFeedback) {
      try {
        webApp.HapticFeedback.impactOccurred(style);
        return;
      } catch (e) {
        console.warn('[TMA] HapticFeedback impact error:', e);
      }
    }

    // Web vibration fallback
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        if (style === 'light') navigator.vibrate(12);
        else if (style === 'soft') navigator.vibrate(22);
        else navigator.vibrate(35);
      } catch {
        // Ignore fallback errors
      }
    }
  }

  /**
   * Haptic notification feedback
   * @param type 'warning' (MISS) | 'error' | 'success'
   */
  public static hapticNotification(type: 'error' | 'success' | 'warning'): void {
    const webApp = this.WebApp;
    if (webApp?.HapticFeedback) {
      try {
        webApp.HapticFeedback.notificationOccurred(type);
        return;
      } catch (e) {
        console.warn('[TMA] HapticFeedback notification error:', e);
      }
    }

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        if (type === 'warning') navigator.vibrate([40, 30, 40]);
        else if (type === 'error') navigator.vibrate([60, 50, 60]);
        else navigator.vibrate(25);
      } catch {
        // Ignore fallback errors
      }
    }
  }
}
