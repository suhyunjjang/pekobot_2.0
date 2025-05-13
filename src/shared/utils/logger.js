/**
 * 로깅 유틸리티 모듈
 */
class Logger {
    constructor() {
        this.socket = null;
    }
    
    /**
     * 소켓 설정 (UI에 로그 전송용)
     * @param {Object} socket - Socket.IO 객체
     */
    setSocket(socket) {
        this.socket = socket;
    }
    
    /**
     * 정보 로그
     * @param {string} source - 로그 출처/모듈명
     * @param {string} message - 로그 메시지
     * @param {Object} details - 추가 상세 정보 (선택적)
     */
    info(source, message, details = null) {
        const logEntry = `[INFO] [${source}] ${message}`;
        console.log(logEntry);
        
        this.emitToUI('info', source, message, details);
    }
    
    /**
     * 경고 로그
     * @param {string} source - 로그 출처/모듈명
     * @param {string} message - 로그 메시지
     * @param {Object} details - 추가 상세 정보 (선택적)
     */
    warn(source, message, details = null) {
        const logEntry = `[WARN] [${source}] ${message}`;
        console.warn(logEntry);
        
        this.emitToUI('warn', source, message, details);
    }
    
    /**
     * 오류 로그
     * @param {string} source - 로그 출처/모듈명
     * @param {string} message - 로그 메시지
     * @param {Object} details - 추가 상세 정보 (선택적)
     */
    error(source, message, details = null) {
        const logEntry = `[ERROR] [${source}] ${message}`;
        console.error(logEntry);
        
        this.emitToUI('error', source, message, details);
    }
    
    /**
     * UI에 로그 전송
     * @param {string} type - 로그 타입 (info/warn/error)
     * @param {string} source - 로그 출처/모듈명
     * @param {string} message - 로그 메시지
     * @param {Object} details - 추가 상세 정보 (선택적)
     */
    emitToUI(type, source, message, details = null) {
        if (this.socket) {
            this.socket.emit('server-log', {
                type,
                source,
                message,
                details,
                timestamp: new Date().toISOString()
            });
        }
    }
    
    /**
     * 콘솔 로그에 타임스탬프 추가 (개발용)
     */
    enableTimestamps() {
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;
        
        console.log = (...args) => {
            const timestamp = new Date().toISOString();
            originalLog(`[${timestamp}]`, ...args);
        };
        
        console.warn = (...args) => {
            const timestamp = new Date().toISOString();
            originalWarn(`[${timestamp}]`, ...args);
        };
        
        console.error = (...args) => {
            const timestamp = new Date().toISOString();
            originalError(`[${timestamp}]`, ...args);
        };
    }
}

module.exports = new Logger(); 