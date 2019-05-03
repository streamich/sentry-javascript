import { EventProcessor, Hub, Integration } from '@sentry/types';
import { fill, getGlobalObject, isMatchingPattern, SentryError, supportsNativeFetch } from '@sentry/utils';

/** JSDoc */
interface TracingOptions {
  tracingOrigins: Array<string | RegExp>;
  traceXHR?: boolean;
  traceFetch?: boolean;
  autoStartOnDomReady?: boolean;
}

/**
 * Tracing Integration
 */
export class Tracing implements Integration {
  /**
   * @inheritDoc
   */
  public name: string = Tracing.id;

  /**
   * @inheritDoc
   */
  public static id: string = 'Tracing';

  /**
   * If we have an xhr we need to store the url in the instance.
   *
   */
  // @ts-ignore
  private _xhrUrl?: string;

  /**
   * Constructor for Tracing
   *
   * @param _options TracingOptions
   */
  public constructor(private readonly _options: TracingOptions) {
    if (!_options.tracingOrigins || !Array.isArray(_options.tracingOrigins) || _options.tracingOrigins.length === 0) {
      throw new SentryError('You need to define `tracingOrigins` in the options. Set an array of urls to trace.');
    }
  }

  /**
   * @inheritDoc
   */
  public setupOnce(_: (callback: EventProcessor) => void, getCurrentHub: () => Hub): void {
    if (this._options.traceXHR !== false) {
      this._traceXHR(getCurrentHub);
    }
    if (this._options.traceFetch !== false) {
      this._traceFetch(getCurrentHub);
    }
    if (this._options.autoStartOnDomReady !== false) {
      getGlobalObject<Window>().addEventListener('DOMContentLoaded', () => {
        Tracing.startTrace(getCurrentHub(), getGlobalObject<Window>().location.href);
      });
    }
  }

  /**
   * Starts a new trace
   * @param hub The hub to start the trace on
   * @param transaction Optional transaction
   */
  public static startTrace(hub: Hub, transaction?: string): void {
    hub.configureScope(scope => {
      scope.startSpan();
      scope.setTransaction(transaction);
    });
  }

  /**
   * JSDoc
   */
  private _traceXHR(getCurrentHub: () => Hub): void {
    if (!('XMLHttpRequest' in global)) {
      return;
    }

    const xhrproto = XMLHttpRequest.prototype;

    fill(
      xhrproto,
      'open',
      originalOpen =>
        function(this: XMLHttpRequest, ...args: any[]): void {
          // @ts-ignore
          const self = getCurrentHub().getIntegration(Tracing);
          if (self) {
            self._xhrUrl = args[1] as string;
          }
          // tslint:disable-next-line: no-unsafe-any
          return originalOpen.apply(this, args);
        },
    );

    fill(
      xhrproto,
      'send',
      originalSend =>
        function(this: XMLHttpRequest, ...args: any[]): void {
          // @ts-ignore
          const self = getCurrentHub().getIntegration(Tracing);
          if (self && self._xhrUrl) {
            const headers = getCurrentHub().traceHeaders();
            let whiteListed = false;
            // tslint:disable-next-line: prefer-for-of
            for (let index = 0; index < self._options.tracingOrigins.length; index++) {
              const whiteListUrl = self._options.tracingOrigins[index];
              whiteListed = isMatchingPattern(self._xhrUrl, whiteListUrl);
              if (whiteListed) {
                break;
              }
            }

            if (whiteListed && this.setRequestHeader) {
              Object.keys(headers).forEach(key => {
                this.setRequestHeader(key, headers[key]);
              });
            }
          }
          // tslint:disable-next-line: no-unsafe-any
          return originalSend.apply(this, args);
        },
    );
  }

  /**
   * JSDoc
   */
  private _traceFetch(getCurrentHub: () => Hub): void {
    if (!supportsNativeFetch()) {
      return;
    }

    // tslint:disable: only-arrow-functions
    fill(getGlobalObject<Window>(), 'fetch', function(originalFetch: () => void): () => void {
      return function(...args: any[]): void {
        // @ts-ignore
        const self = getCurrentHub().getIntegration(Tracing);
        if (self) {
          const url = args[0] as string;
          const options = args[1] as { [key: string]: any };

          let whiteListed = false;
          self._options.tracingOrigins.forEach((whiteListUrl: string) => {
            if (!whiteListed) {
              whiteListed = isMatchingPattern(url, whiteListUrl);
            }
          });

          if (options && whiteListed) {
            if (options.headers) {
              options.headers = {
                ...options.headers,
                ...getCurrentHub().traceHeaders(),
              };
            } else {
              options.headers = getCurrentHub().traceHeaders();
            }
          }
        }
        // tslint:disable-next-line: no-unsafe-any
        return originalFetch.apply(global, args);
      };
    });
    // tslint:enable: only-arrow-functions
  }
}