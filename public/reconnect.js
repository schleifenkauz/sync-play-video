(function () {
    function canReconnect() {
        const visible = document.visibilityState !== 'hidden';
        const online = typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
        return visible && online;
    }

    function createReconnectController(options = {}) {
        const initialDelay = options.initialDelay ?? 1000;
        const maxDelay = options.maxDelay ?? 30000;
        let reconnectTimer = null;
        let currentDelay = initialDelay;

        function scheduleReconnect() {
            clearTimeout(reconnectTimer);

            if (!canReconnect()) {
                return;
            }

            reconnectTimer = setTimeout(() => {
                if (!canReconnect()) {
                    scheduleReconnect();
                    return;
                }

                const shouldReconnect = typeof options.shouldReconnect === 'function'
                    ? options.shouldReconnect()
                    : true;

                if (shouldReconnect && typeof options.onReconnect === 'function') {
                    options.onReconnect();
                }

                currentDelay = Math.min(currentDelay * 2, maxDelay);
            }, currentDelay);
        }

        function handlePageStateChange() {
            if (!canReconnect()) {
                clearTimeout(reconnectTimer);
                return;
            }

            const shouldReconnect = typeof options.shouldReconnect === 'function'
                ? options.shouldReconnect()
                : true;

            if (shouldReconnect) {
                scheduleReconnect();
            }
        }

        function resetDelay() {
            currentDelay = initialDelay;
        }

        function cancel() {
            clearTimeout(reconnectTimer);
        }

        document.addEventListener('visibilitychange', handlePageStateChange);
        window.addEventListener('online', handlePageStateChange);
        window.addEventListener('offline', handlePageStateChange);

        return {
            canReconnect,
            scheduleReconnect,
            handlePageStateChange,
            resetDelay,
            cancel
        };
    }

    window.ReconnectController = {
        canReconnect,
        create: createReconnectController
    };
})();
