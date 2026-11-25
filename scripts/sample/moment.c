// The moment and the ids a program sees: the real-time clock stands still at
// SAMPLE_AT (seconds since 1970), and a read of 13 random bytes, which is what
// one of medrec's ids is made of, comes from SAMPLE_SEED and how many came
// before it. Everything else is the system's. A program it is loaded into has
// a file of its process id in the folder SAMPLE_LOADED.
#define _GNU_SOURCE
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

__attribute__((constructor)) static void loaded(void) {
  const char *dir = getenv("SAMPLE_LOADED");
  char path[1024];
  if (!dir || snprintf(path, sizeof path, "%s/%ld", dir, (long)getpid()) >= (int)sizeof path) return;
  int fd = open(path, O_CREAT | O_WRONLY | O_CLOEXEC, 0600);
  if (fd >= 0) close(fd);
}

static uint64_t mix(uint64_t x) {
  x += 0x9e3779b97f4a7c15ULL;
  x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
  x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
  return x ^ (x >> 31);
}

static int id_bytes(void *buf, size_t n) {
  static uint64_t drawn;
  const char *seed = getenv("SAMPLE_SEED");
  if (n != 13 || !seed) return 0;
  uint64_t h = 0xcbf29ce484222325ULL;
  for (; *seed; seed++) h = (h ^ (unsigned char)*seed) * 0x100000001b3ULL;
  uint64_t at = h ^ mix(__atomic_add_fetch(&drawn, 1, __ATOMIC_RELAXED));
  uint64_t words[2] = {mix(at), mix(at + 1)};
  memcpy(buf, words, n);
  return 1;
}

static int moment(clockid_t clock, struct timespec *out) {
  const char *at = getenv("SAMPLE_AT");
  if (clock != CLOCK_REALTIME || !at) return 0;
  out->tv_sec = (time_t)strtoll(at, NULL, 10);
  out->tv_nsec = 0;
  return 1;
}

#ifdef __APPLE__
#include <sys/random.h>
static int sample_getentropy(void *buf, size_t n) { return id_bytes(buf, n) ? 0 : getentropy(buf, n); }
static int sample_clock_gettime(clockid_t clock, struct timespec *out) { return moment(clock, out) ? 0 : clock_gettime(clock, out); }
#define INTERPOSE(with, of) \
  __attribute__((used, section("__DATA,__interpose"))) static const struct { const void *w, *o; } ip_##of = {(const void *)&with, (const void *)&of};
INTERPOSE(sample_getentropy, getentropy)
INTERPOSE(sample_clock_gettime, clock_gettime)
#else
#include <dlfcn.h>
#include <stdarg.h>
#include <sys/syscall.h>
// Some programs ask the kernel for random bytes themselves.
long syscall(long number, ...) {
  static long (*next)(long, ...);
  long a[6];
  va_list args;
  va_start(args, number);
  for (int i = 0; i < 6; i++) a[i] = va_arg(args, long);
  va_end(args);
  if (number == SYS_getrandom && id_bytes((void *)a[0], (size_t)a[1])) return a[1];
  if (!next) next = (long (*)(long, ...))dlsym(RTLD_NEXT, "syscall");
  return next(number, a[0], a[1], a[2], a[3], a[4], a[5]);
}
ssize_t getrandom(void *buf, size_t n, unsigned flags) { return id_bytes(buf, n) ? (ssize_t)n : syscall(SYS_getrandom, buf, n, flags); }
int clock_gettime(clockid_t clock, struct timespec *out) { return moment(clock, out) ? 0 : (int)syscall(SYS_clock_gettime, clock, out); }
#endif
