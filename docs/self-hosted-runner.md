# Owner-operated runner (inactive example)

The [workflow example](../.github/workflows/owner-isolated-runner.yml.example)
is inert: GitHub Actions does not load it as a workflow. No runner was
registered, started, or granted access. The existing GitHub-hosted checks
continue unchanged; this example only runs selected Bend, proof, and archive
checks and an optional serial training study. It has no GPU job or GPU parity
result yet.

**Keep this disabled on a public repository unless you can restrict the
isolated runner to reviewed pushes to main. Never attach a runner that can
read your desktop or home directory.** Prefer a private repository with
tightly restricted writers and a disposable, dedicated Linux x86-64 VM.
[GitHub's security guidance](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners)
recommends almost never using self-hosted runners on public repositories.
A label is routing, not access control; this example's guards cannot stop
other workflows with access to the runner.

## Before the owner enables anything

1. Use a VM or dedicated isolated host with its own non-admin account. Give it
   no personal mounts, credentials, SSH agent, browser profile, cloud tokens,
   privileged container socket, or passwordless sudo. Provision the pinned
   [toolchain](testing.md#set-up-a-machine) in that environment only. Ensure
   Bash, Git, Node 24.22.3, Bend 2.0.40 and Lean 4.34.0 are on the runner's
   path. The workflow validates versions without installing tools.
2. Protect the main branch against unreviewed changes. Audit all workflows
   and repository access. Where supported, use a restricted runner group
   allowing only this workflow on main in this repository. Do not use a
   shared or broadly available runner group, or allow pull requests, forks,
   issue events, reusable calls, or manual runs onto this runner. If you
   cannot enforce that boundary, leave it disabled.
3. Follow [GitHub's runner registration guide](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)
   in the isolated environment and register it yourself with the
   `bend-studio-phase11-isolated` label. Use an
   [ephemeral runner](https://docs.github.com/en/actions/reference/runners/self-hosted-runners#ephemeral-runners-for-autoscaling)
   and destroy the disposable workspace after each job. Keep aggregate
   training and compilation within the Phase 11 machine's 12 GB allowance
   using the isolation layer's resource controls. This workflow uses a
   timeout and serial study, not a hard memory limit.
4. In the intended repository, set the Actions variable
   `BEND_RUNNER_REPOSITORY` to its exact owner/name. Only after reviewing the
   protections, set `BEND_RUNNER_ENABLE` to `true` and copy the example to
   a file with a .yml extension under the workflows directory. Only
   pushes to main can trigger that workflow; the checkout uses the triggering
   commit and does not persist Git credentials. It requests no secrets and
   only read access to repository contents. Public use additionally requires
   `BEND_RUNNER_ALLOW_PUBLIC` set to `true`; leave it unset by default.

The ordinary checks run without the optional study. Set
`BEND_RUNNER_LONG_STUDY` to `true` only if you want each eligible push to
run a full [flagship v2](../studies/flagship-toy-text-v2/README.md) study
serially. It trains with the triggering revision and verifies the sealed
archive locally in the runner's temporary workspace. It does not upload an
archive or publish parity or speedup claims. Run only one workload at a time
on the hardware when collecting comparable performance evidence.

When an actual CUDA parity command exists, add it separately after reviewing
its resource use and the runner's device access. A machine with no NVIDIA GPU
can explicitly skip execution. A present but inaccessible GPU or a failing
parity run is not a pass.

To stop, disable the workflow and remove the runner from the repository
before reusing or destroying its host. Unset the opt-in variables as well.
