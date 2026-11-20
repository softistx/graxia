# @graxia/graphiql

## 0.2.5

### Patch Changes

- Updated dependencies [[`e802b0a`](https://github.com/softistx/graxia/commit/e802b0a7c2ab281228222797e36c4e70143c0ccc)]:
  - @graxia/core@0.11.0

## 0.2.4

### Patch Changes

- Updated dependencies [[`8efc081`](https://github.com/softistx/graxia/commit/8efc081372345df50387894f77f2b36a97194f6d), [`1b7629d`](https://github.com/softistx/graxia/commit/1b7629d1445ce83ca201ae375967cb899b845ed2)]:
  - @graxia/core@0.10.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`730f845`](https://github.com/softistx/graxia/commit/730f845cb04e1cd64d1fecbc3821285ec6f03519)]:
  - @graxia/core@0.9.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`b2b814f`](https://github.com/softistx/graxia/commit/b2b814f62d03c658b3948c45ba9dca1b71a6bc40), [`c7c407e`](https://github.com/softistx/graxia/commit/c7c407e43784e509b49066b2faeeae9494d9cc52), [`54aaf11`](https://github.com/softistx/graxia/commit/54aaf115cf1ec6d566e37806fb18877263d7d462)]:
  - @graxia/core@0.8.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`b0cd3ec`](https://github.com/softistx/graxia/commit/b0cd3ec4999a20ac5bb3c435483a08424a4bb7e4)]:
  - @graxia/core@0.7.0

## 0.2.0

### Minor Changes

- [#128](https://github.com/softistx/graxia/pull/128) [`8dc1b74`](https://github.com/softistx/graxia/commit/8dc1b7482c3f6501b662fe405ead76f2805f8126) Thanks [@SteveGT96](https://github.com/SteveGT96)! - `enabled` of `graphiql()` and `apolloSandbox()` also takes a function `(request: Request) => boolean`, called for each GET the explorer would answer; `false` falls through as a disabled explorer does. A value that is neither a boolean nor a function throws a `GraxiaConfigError`. The docs now say that an unset `NODE_ENV` serves the page and show `enabled: () => myDevFlag`.

### Patch Changes

- Updated dependencies [[`5ddb586`](https://github.com/softistx/graxia/commit/5ddb5869b08d50f408ac6864a53a0c4652097c0d), [`8397f98`](https://github.com/softistx/graxia/commit/8397f98a041b82e231ef33a667876df61082dcf0), [`83904e4`](https://github.com/softistx/graxia/commit/83904e4657269574b55f6b0a61c36d44d380975e), [`178a736`](https://github.com/softistx/graxia/commit/178a736f2d0ac489ce054184150aecab9a78149e)]:
  - @graxia/core@0.6.3

## 0.1.2

### Patch Changes

- [#103](https://github.com/softistx/graxia/pull/103) [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11) Thanks [@SteveGT96](https://github.com/SteveGT96)! - The docs link to other packages' pages and to the repository roadmap with absolute GitHub URLs, so the links work on the npm page.
- Updated dependencies [[`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11), [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11), [`33ef321`](https://github.com/softistx/graxia/commit/33ef3215c1efaabcb615c1484134d720a0310a11)]:
  - @graxia/core@0.6.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`6ec2589`](https://github.com/softistx/graxia/commit/6ec2589e1de9241b8d6fc52de73a66ef629bd0e1), [`6ec2589`](https://github.com/softistx/graxia/commit/6ec2589e1de9241b8d6fc52de73a66ef629bd0e1)]:
  - @graxia/core@0.5.0

## 0.1.0

### Minor Changes

- [#84](https://github.com/softistx/graxia/pull/84) [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Apollo Sandbox option: `apolloSandbox()` plugin serving Apollo's embeddable Sandbox from the endpoint, with a per-page CSP naming only Apollo's two hosts, development only by default. `graphiql()` and `apolloSandbox()` cannot both be enabled on one instance.

- [#84](https://github.com/softistx/graxia/pull/84) [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9) Thanks [@SteveGT96](https://github.com/SteveGT96)! - GraphiQL page, bundled for a strict CSP: `graphiql()` plugin serving GraphiQL 4 from the endpoint itself, with no CDN or external URL, development only by default.

### Patch Changes

- Updated dependencies [[`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9), [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9), [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9), [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9), [`7731216`](https://github.com/softistx/graxia/commit/7731216aa371de460c0360a461902363d1586681), [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9), [`ce91d85`](https://github.com/softistx/graxia/commit/ce91d850a918083960a2e40d0297652003312fa9)]:
  - @graxia/core@0.4.0
