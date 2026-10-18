// One build graph lets BuildKit build both images concurrently and reuse layers.
group "default" {
  targets = ["frontend", "backend"]
}

target "common" {
  context    = "."
  dockerfile = "Dockerfile"
  platforms  = ["linux/amd64"]
  labels = {
    "org.opencontainers.image.source" = "https://github.com/lyashahid/datathon"
  }
}

target "frontend" {
  inherits = ["common"]
  target   = "frontend"
  args = {
    PUBLIC_BASE_PATH = "/apps/datathon"
  }
  cache-from = ["type=gha,scope=frontend"]
  cache-to   = ["type=gha,scope=frontend,mode=max"]
}

target "backend" {
  inherits   = ["common"]
  target     = "backend"
  cache-from = ["type=gha,scope=backend"]
  cache-to   = ["type=gha,scope=backend,mode=max"]
}
