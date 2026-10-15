import 'dart:convert';

import 'package:json_schema/json_schema.dart';

import 'errors.dart';
import 'generated/contract.g.dart';

// The extension protocol schemas are the Python server's files, copied into
// `generated/contract.g.dart`: both servers validate against the same ones.
final _v1 = jsonDecode(protocolV1Schema) as Map<String, dynamic>;
final _v2 = jsonDecode(protocolV2Schema) as Map<String, dynamic>;

JsonSchema _validator(Map<String, dynamic> schema, String definition) =>
    JsonSchema.create({
      ...schema,
      r'$ref': '#/\$defs/$definition',
    }, schemaVersion: SchemaVersion.draft2020_12);

final _serverMessage = _validator(_v1, 'serverMessage');
final _extensionInitial = _validator(_v1, 'extensionInitialMessage');
final _extensionV2Initial = _validator(_v2, 'extensionInitialMessage');
final _extensionRuntime = _validator(_v1, 'extensionRuntimeMessage');

void _validate(JsonSchema validator, Object? message, String label) {
  final result = validator.validate(message);
  if (result.isValid) return;
  final error = result.errors.first;
  final path = error.instancePath.replaceFirst('/', '').replaceAll('/', '.');
  final location = path.isEmpty ? '' : ' at $path';
  throw ProtocolValidationError('Invalid $label$location: ${error.message}');
}

void validateServerMessage(Object? message) =>
    _validate(_serverMessage, message, 'server message');

void validateExtensionInitialMessage(Object? message) => _validate(
  message is Map && message['protocolVersion'] == 2
      ? _extensionV2Initial
      : _extensionInitial,
  message,
  'extension hello',
);

void validateExtensionRuntimeMessage(Object? message) =>
    _validate(_extensionRuntime, message, 'extension runtime message');
