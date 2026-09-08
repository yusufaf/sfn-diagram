import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createDebouncer } from './debounce'

describe('createDebouncer', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('does not fire before delayMs elapses', () => {
        const run = vi.fn()
        const debouncer = createDebouncer({ delayMs: 200, run })

        debouncer.schedule('a')
        vi.advanceTimersByTime(199)

        expect(run).not.toHaveBeenCalled()
    })

    it('fires once delayMs elapses, with the scheduled value', () => {
        const run = vi.fn()
        const debouncer = createDebouncer({ delayMs: 200, run })

        debouncer.schedule('a')
        vi.advanceTimersByTime(200)

        expect(run).toHaveBeenCalledTimes(1)
        expect(run).toHaveBeenCalledWith('a')
    })

    it('coalesces a burst of schedule() calls into a single run with the last value', () => {
        const run = vi.fn()
        const debouncer = createDebouncer({ delayMs: 200, run })

        debouncer.schedule('a')
        vi.advanceTimersByTime(100)
        debouncer.schedule('b')
        vi.advanceTimersByTime(100)
        debouncer.schedule('c')
        vi.advanceTimersByTime(200)

        expect(run).toHaveBeenCalledTimes(1)
        expect(run).toHaveBeenCalledWith('c')
    })

    it('cancel() prevents a pending call from firing', () => {
        const run = vi.fn()
        const debouncer = createDebouncer({ delayMs: 200, run })

        debouncer.schedule('a')
        debouncer.cancel()
        vi.advanceTimersByTime(500)

        expect(run).not.toHaveBeenCalled()
    })

    it('cancel() is idempotent when nothing is pending', () => {
        const run = vi.fn()
        const debouncer = createDebouncer({ delayMs: 200, run })

        expect(() => {
            debouncer.cancel()
            debouncer.cancel()
        }).not.toThrow()
        expect(run).not.toHaveBeenCalled()
    })

    it('a schedule() after a completed run starts a fresh delay', () => {
        const run = vi.fn()
        const debouncer = createDebouncer({ delayMs: 200, run })

        debouncer.schedule('a')
        vi.advanceTimersByTime(200)
        expect(run).toHaveBeenCalledTimes(1)

        debouncer.schedule('b')
        vi.advanceTimersByTime(199)
        expect(run).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(1)
        expect(run).toHaveBeenCalledTimes(2)
        expect(run).toHaveBeenLastCalledWith('b')
    })
})
