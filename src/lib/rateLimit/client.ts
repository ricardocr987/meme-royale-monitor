import { Mutex } from './concurrence'
import { sleep } from './time'
import { RateLimitI } from './common'

export class RateLimitClient {
  protected mutex = new Mutex()

  constructor(protected rateLimit: RateLimitI) {}

  async acquire(weight?: number): Promise<() => void> {
    const release = await this.mutex.acquire()

    try {
      let now: number
      let check: boolean

      do {
        now = Date.now()
        check = this.rateLimit.check(now, weight)

        if (!check) {
          const time = this.rateLimit.nextTry(now, weight)
          await sleep(time)
        }
      } while (!check)

      this.rateLimit.add(now, weight)

      return () => {
        this.rateLimit.sub(now, weight)
      }
    } finally {
      release()
    }
  }
}
