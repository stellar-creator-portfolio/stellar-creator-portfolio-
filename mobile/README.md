# Stellar Mobile Application

React Native mobile application for the Stellar Creator Portfolio platform, built with Expo.

## Issues Implemented

This implementation addresses the following GitHub issues:

### Issue #563: Interactive Onboarding Walkthrough
**"Design standard distinct comprehensive interactive new user Application walkthroughs visually"**

**Implementation:** `src/components/onboarding/OnboardingWalkthrough.tsx`

Features:
- Multi-step interactive walkthrough with 5 comprehensive steps
- Swipeable carousel with smooth gesture support
- Animated progress indicators with dynamic dot sizing
- Skip functionality for experienced users
- Haptic feedback on all interactions
- Full dark mode support with theme integration
- Optimized rendering with zero frame drops
- Accessible with proper ARIA labels and roles
- Auto-scroll and pagination tracking

**Usage:**
```tsx
import { OnboardingWalkthrough } from './components/onboarding/OnboardingWalkthrough';

<OnboardingWalkthrough 
  onComplete={() => console.log('Onboarding completed')}
  onSkip={() => console.log('Onboarding skipped')}
/>
```

---

### Issue #562: Mobile Form Validation
**"Leverage specific generalized standard localized Mobile form validations identically securely"**

**Implementation:** `src/utils/formValidation.ts` + `src/components/forms/ValidatedInput.tsx`

Features:
- Comprehensive validation rules (email, password, phone, URL, Stellar address, etc.)
- Localized error messages
- Type-safe validation functions
- Secure input sanitization (HTML stripping, XSS prevention)
- Real-time and on-blur validation support
- Custom validation rule composition
- Debounced validation to prevent performance issues
- Form-level validation with error aggregation
- Common validator presets for login, signup, profiles, bounties

**Available Validators:**
- `required` - Required field validation
- `email` - RFC 5322 compliant email validation
- `password` - Strong password requirements
- `phone` - International phone number format
- `url` - Valid URL validation
- `numeric` - Number validation
- `range` - Min/max range validation
- `minLength` / `maxLength` - Length constraints
- `pattern` - Custom regex patterns
- `match` - Value matching (password confirmation)
- `stellarAddress` - Stellar blockchain address validation
- `username` - Alphanumeric username validation

**Usage:**
```tsx
import { ValidatedInput } from './components/forms/ValidatedInput';
import { Validators, Sanitizers, composeValidators } from './utils/formValidation';

<ValidatedInput
  label="Email"
  value={email}
  onChangeText={setEmail}
  validator={composeValidators(
    Validators.required('Email is required'),
    Validators.email()
  )}
  sanitizer={Sanitizers.lowercase}
  validateOnChange
  required
/>
```

---

### Issue #558: Direct Messaging Layout
**"Develop specific distinct interactive Direct Messaging layout architectures"**

**Implementation:** `src/screens/MessagingScreen.tsx`

Features:
- Real-time message display with optimized FlatList rendering
- Distinct message bubbles for sender/receiver with color coding
- Message status indicators (sending, sent, delivered, read, failed)
- Typing indicators with animated dots
- Relative timestamps (just now, 5m ago, 2h ago, etc.)
- Keyboard-aware layout that adjusts to keyboard
- Pull-to-refresh for loading message history
- Message input with character limit (1000 chars)
- Send button with disabled state for empty messages
- Full dark mode support
- Zero frame drops with memoized rendering
- Accessibility labels and roles
- Haptic feedback on send

**Usage:**
```tsx
import { MessagingScreen } from './screens/MessagingScreen';

<MessagingScreen
  conversationId="conv-123"
  currentUserId="user-1"
  recipientName="Alice Johnson"
  onBack={() => navigation.goBack()}
/>
```

---

### Issue #559: WebSocket Integration
**"Integrate specific fluid interactive standard Websocket capabilities comprehensively"**

**Implementation:** 
- `src/services/WebSocketService.ts` - Core WebSocket service
- `src/hooks/useWebSocketConnection.ts` - React hooks for WebSocket

Features:
- Robust WebSocket connection management
- Automatic reconnection with exponential backoff (max 10 attempts)
- Connection state tracking (connecting, connected, disconnected, reconnecting, error)
- Message queuing for offline scenarios (up to 100 messages)
- Event-based message handling with type safety
- Heartbeat/ping-pong for connection health monitoring
- Type-safe message protocols
- Comprehensive error handling and recovery
- React hooks for easy integration
- Singleton pattern for global service instance
- Automatic cleanup on unmount

**WebSocket Service Usage:**
```tsx
import { WebSocketService } from './services/WebSocketService';

const ws = new WebSocketService({
  url: 'wss://api.stellar.com/ws',
  reconnectInterval: 3000,
  maxReconnectAttempts: 10,
  heartbeatInterval: 30000,
});

// Connect
ws.connect();

// Send message
ws.send('chat.message', { text: 'Hello!', recipientId: 'user-2' });

// Subscribe to messages
const unsubscribe = ws.on('chat.message', (message) => {
  console.log('Received:', message.payload);
});

// Monitor connection state
ws.onStateChange((state) => {
  console.log('Connection state:', state);
});

// Cleanup
ws.disconnect();
```

**React Hook Usage:**
```tsx
import { useWebSocketConnection } from './hooks/useWebSocketConnection';
import { getWebSocketService } from './services/WebSocketService';

function ChatComponent() {
  const ws = getWebSocketService({ url: 'wss://api.stellar.com/ws' });
  const { connectionState, isConnected, send, subscribe } = useWebSocketConnection(ws);

  useEffect(() => {
    const unsubscribe = subscribe('chat.message', (message) => {
      console.log('New message:', message.payload);
    });
    return unsubscribe;
  }, [subscribe]);

  const handleSend = () => {
    send('chat.message', { text: 'Hello!' });
  };

  return (
    <View>
      <Text>Status: {connectionState}</Text>
      <Button onPress={handleSend} disabled={!isConnected} title="Send" />
    </View>
  );
}
```

---

## Project Structure

```
mobile/
├── src/
│   ├── components/
│   │   ├── dashboard/          # Dashboard components (existing)
│   │   ├── forms/              # Form components (Issue #562)
│   │   │   └── ValidatedInput.tsx
│   │   ├── offline/            # Offline support (existing)
│   │   └── onboarding/         # Onboarding components (Issue #563)
│   │       └── OnboardingWalkthrough.tsx
│   ├── hooks/
│   │   ├── useOfflineData.ts   # Offline data hook (existing)
│   │   └── useWebSocketConnection.ts  # WebSocket hooks (Issue #559)
│   ├── navigation/
│   │   ├── AppNavigator.tsx    # Main navigation (existing)
│   │   └── transitions.ts      # Screen transitions (existing)
│   ├── offline/
│   │   ├── NetworkProvider.tsx # Network state management (existing)
│   │   ├── OfflineQueue.ts     # Offline operation queue (existing)
│   │   └── OfflineStore.ts     # Offline storage (existing)
│   ├── screens/
│   │   ├── DashboardScreen.tsx # Analytics dashboard (existing)
│   │   ├── MessagingScreen.tsx # Direct messaging (Issue #558)
│   │   ├── OnboardingScreen.tsx # Onboarding wrapper (Issue #563)
│   │   ├── OfflineScreen.tsx   # Offline mode (existing)
│   │   └── ThemeSettingsScreen.tsx # Theme settings (existing)
│   ├── services/
│   │   └── WebSocketService.ts # WebSocket service (Issue #559)
│   ├── theme/
│   │   ├── ThemeProvider.tsx   # Theme context (existing)
│   │   └── tokens.ts           # Design tokens (existing)
│   ├── types/
│   │   └── index.ts            # TypeScript types (existing)
│   ├── utils/
│   │   └── formValidation.ts   # Form validation (Issue #562)
│   └── index.tsx               # App entry point
├── app.json                    # Expo configuration
├── babel.config.js             # Babel configuration
├── package.json                # Dependencies
├── tsconfig.json               # TypeScript configuration
└── README.md                   # This file
```

## Installation

```bash
cd mobile
npm install
# or
yarn install
```

## Running the App

### Development

```bash
# Start Expo dev server
npm start

# Run on iOS simulator
npm run ios

# Run on Android emulator
npm run android

# Run in web browser
npm run web
```

### Production Build

```bash
# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android
```

## Dependencies

### Core
- `expo` ~51.0.0 - Expo framework
- `react` 18.2.0 - React library
- `react-native` 0.74.1 - React Native framework

### Navigation
- `@react-navigation/native` ^6.1.17
- `@react-navigation/native-stack` ^6.9.26
- `@react-navigation/bottom-tabs` ^6.5.20
- `react-native-screens` 3.31.1
- `react-native-safe-area-context` 4.10.1

### UI & Gestures
- `react-native-gesture-handler` ~2.16.1
- `react-native-reanimated` ~3.10.1
- `react-native-svg` 15.2.0
- `expo-haptics` ~13.0.1 - Haptic feedback

### Storage & Network
- `@react-native-async-storage/async-storage` ^1.23.1
- `@react-native-community/netinfo` ^11.3.1
- `expo-network` ~6.0.1

### Localization
- `expo-localization` ~15.0.3

### Build
- `expo-build-properties` ~0.12.0

## Testing

```bash
# Run type checking
npm run type-check

# Run linting
npm run lint
```

## Features

### Offline Support
- Automatic data caching with AsyncStorage
- Offline operation queue
- Network state detection
- Stale data indicators
- Pull-to-refresh

### Theme Support
- Light and dark modes
- System theme detection
- Persistent theme preference
- Smooth theme transitions

### Performance
- Optimized FlatList rendering
- Memoized components
- Debounced validation
- Zero frame drops
- Efficient re-renders

### Accessibility
- ARIA labels and roles
- Screen reader support
- Keyboard navigation
- High contrast support
- Semantic HTML

## Environment Variables

Create a `.env` file in the mobile directory:

```env
EXPO_PUBLIC_API_URL=https://api.stellar.com
EXPO_PUBLIC_WS_URL=wss://api.stellar.com/ws
EXPO_PUBLIC_STELLAR_NETWORK=testnet
```

## Contributing

1. Create a feature branch
2. Implement changes
3. Run type checking and linting
4. Test on iOS and Android
5. Submit pull request

## License

MIT License - See LICENSE file for details
