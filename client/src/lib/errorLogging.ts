interface ErrorLogPayload {
  message: string;
  stack?: string;
  componentStack?: string;
  location?: string;
  timestamp: string;
  context?: string;
}

export async function logErrorToServer(error: Error, context?: string) {
  try {
    const errorPayload: ErrorLogPayload = {
      message: error.message,
      stack: error.stack,
      componentStack: error instanceof Error ? error.stack : undefined,
      location: window.location.href,
      timestamp: new Date().toISOString(),
      context,
    };

    await fetch('/api/log/error', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(errorPayload),
      credentials: 'include',
    });
  } catch (e) {
    // Fallback to console if server logging fails
    console.error('Failed to log error to server:', e);
    console.error('Original error:', error);
  }
}

// Global error handler for uncaught errors
window.addEventListener('error', (event) => {
  event.preventDefault();
  logErrorToServer(event.error);
});

// Global handler for unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  logErrorToServer(new Error(event.reason));
});