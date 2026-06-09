#include "control_server.h"

#include <cerrno>
#include <cstring>
#include <iostream>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace playoutd {

ControlServer::ControlServer(std::string socketPath) : socketPath_(std::move(socketPath)) {}

ControlServer::~ControlServer() {
  stop();
}

bool ControlServer::start() {
  if (running_.load()) return true;

  ::unlink(socketPath_.c_str());

  listenFd_ = ::socket(AF_UNIX, SOCK_STREAM, 0);
  if (listenFd_ < 0) {
    std::cerr << "[playoutd] socket() failed: " << std::strerror(errno) << "\n";
    return false;
  }

  sockaddr_un addr {};
  addr.sun_family = AF_UNIX;
  if (socketPath_.size() >= sizeof(addr.sun_path)) {
    std::cerr << "[playoutd] control socket path too long\n";
    ::close(listenFd_);
    listenFd_ = -1;
    return false;
  }
  std::strncpy(addr.sun_path, socketPath_.c_str(), sizeof(addr.sun_path) - 1);

  if (::bind(listenFd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
    std::cerr << "[playoutd] bind(" << socketPath_ << ") failed: " << std::strerror(errno) << "\n";
    ::close(listenFd_);
    listenFd_ = -1;
    return false;
  }

  if (::listen(listenFd_, 16) != 0) {
    std::cerr << "[playoutd] listen() failed: " << std::strerror(errno) << "\n";
    ::close(listenFd_);
    listenFd_ = -1;
    return false;
  }

  running_.store(true);
  thread_ = std::thread([this] { listenLoop(); });
  std::cout << "[playoutd] control socket " << socketPath_ << "\n";
  return true;
}

void ControlServer::stop() {
  running_.store(false);
  if (listenFd_ >= 0) {
    ::shutdown(listenFd_, SHUT_RDWR);
    ::close(listenFd_);
    listenFd_ = -1;
  }
  if (thread_.joinable()) thread_.join();
  ::unlink(socketPath_.c_str());
}

bool ControlServer::drainCommands(std::deque<ControlCommand>& out) {
  std::lock_guard<std::mutex> lock(queueMutex_);
  if (queue_.empty()) return false;
  out.insert(out.end(), queue_.begin(), queue_.end());
  queue_.clear();
  return true;
}

void ControlServer::listenLoop() {
  while (running_.load(std::memory_order_acquire)) {
    const int client = ::accept(listenFd_, nullptr, nullptr);
    if (client < 0) {
      if (!running_.load()) break;
      if (errno == EINTR) continue;
      continue;
    }

    std::string buffer;
    char chunk[4096];
    while (running_.load()) {
      const ssize_t n = ::recv(client, chunk, sizeof(chunk), 0);
      if (n <= 0) break;
      buffer.append(chunk, static_cast<size_t>(n));
      size_t pos = 0;
      while ((pos = buffer.find('\n')) != std::string::npos) {
        std::string line = buffer.substr(0, pos);
        buffer.erase(0, pos + 1);
        if (line.empty()) continue;
        ControlCommand cmd = parseControlLine(line);
        if (cmd.type == CommandType::Unknown) continue;
        {
          std::lock_guard<std::mutex> lock(queueMutex_);
          queue_.push_back(std::move(cmd));
        }
      }
    }
    ::close(client);
  }
}

} // namespace playoutd
