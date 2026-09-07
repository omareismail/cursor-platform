# Skill: flutter-model-gen

**Invocation:** `/flutter-model-gen [model name/fields]`

---

## Overview

`flutter-model-gen` generates an immutable data class using `freezed` +
`json_serializable` — the standard combination for domain/DTO models in a
Riverpod-based Flutter app: value equality, `copyWith`, and JSON
(de)serialization generated rather than hand-written.

**Memory references:** `memory-bank/techContext.md` (confirm `freezed` and
`json_serializable` are already in `pubspec.yaml` before using them —
`10-evidence-and-dependency-guard.mdc`), `memory-bank/domainRules.md`.

**Guard rules:** `10-evidence-and-dependency-guard.mdc`.

---

## Steps

**Step 0 — Confirm the packages are present.** Check `pubspec.yaml` for
`freezed_annotation`/`freezed`, `json_annotation`/`json_serializable`, and
`build_runner`. If they're not present, do not add them silently — flag it
as a recommendation and ask, or fall back to a hand-written immutable class
with manual `==`/`hashCode`/`copyWith`/`fromJson`/`toJson` if the user
wants to proceed without codegen.

**Step 1 — Find the pattern.** Run `pattern-scout` for an existing
`freezed` model in the repo to match naming (`Order` vs `OrderModel`),
whether models use `@JsonKey` for snake_case API fields, and where models
live (`domain/` vs a shared `models/` folder).

**Step 2 — Generate the model.**

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'order.freezed.dart';
part 'order.g.dart';

@freezed
class Order with _$Order {
  const factory Order({
    required String id,
    required DateTime createdAt,
    required List<OrderLine> lines,
    @JsonKey(name: 'total_amount') required double totalAmount,
    @Default(OrderStatus.pending) OrderStatus status,
  }) = _Order;

  factory Order.fromJson(Map<String, dynamic> json) => _$OrderFromJson(json);
}
```

- Every field that isn't genuinely optional is `required` — do not make
  fields nullable purely to avoid dealing with the API contract; nullable
  is for fields the API genuinely may omit.
- Use `@JsonKey(name: '...')` when the API field name doesn't match Dart's
  `lowerCamelCase` convention — do not rename the API field without a
  `@JsonKey` mapping, or deserialization silently produces nulls/defaults.
- Enums use `@JsonEnum`/`JsonValue` mapping if the API's string values
  don't match the Dart enum member names.

**Step 3 — Note the `build_runner` step.** Generated code requires:
```
dart run build_runner build --delete-conflicting-outputs
```
State this explicitly in the response — the `.freezed.dart`/`.g.dart` files
this skill describes are not hand-written; they don't exist until
`build_runner` runs. Do not fabricate their contents by hand.

**Step 4 — Generate a construction test.** A short unit test that builds
the model from a representative JSON fixture and asserts field values,
plus a round-trip `toJson`/`fromJson` equality check — catches `@JsonKey`
mapping mistakes immediately per `04-flutter-test-guard.mdc`.

---

## Example

Request: "Generate a model for a user profile with id, name, email,
optional avatar URL."

Output: `lib/features/profile/domain/user_profile.dart` with `@freezed`
class, `avatarUrl` as the only nullable field, and
`test/features/profile/domain/user_profile_test.dart` with a JSON
round-trip test. Reminder to run `build_runner` before the code compiles.
