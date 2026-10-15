import 'dart:convert';
import 'dart:io';

import 'errors.dart';
import 'registry.dart';

/// The browser operations, with the same argument checks and result checks
/// as the Python server's `BrowserController` (`bridge.py`): one method per
/// extension command, each adding the browser ID to what it returns.
class BrowserController {
  BrowserController(this._registry);

  final BrowserRegistry _registry;

  List<Json> instances() => _registry.instances();

  BrowserConnection _connection(String? browserId) =>
      _registry.resolve(browserId);

  static List<int>? _version(String version) {
    final m = RegExp(r'^(\d+)\.(\d+)\.(\d+)(?:\.\d+)?$').firstMatch(version);
    return m == null ? null : [for (var i = 1; i <= 3; i++) int.parse(m[i]!)];
  }

  static bool _atLeast(List<int>? v, List<int> min) {
    if (v == null) return false;
    for (var i = 0; i < 3; i++) {
      if (v[i] != min[i]) return v[i] > min[i];
    }
    return true;
  }

  static void _requireExtension(BrowserConnection c, List<int> min) {
    if (!_atLeast(_version(c.extensionVersion), min)) {
      throw ExtensionCommandError(
        'This tool requires Chrome Bridge extension ${min.join('.')} or newer; '
        "connected extension is '${c.extensionVersion}'. Upgrade the "
        'Chrome extension and retry with the same browser_id.',
      );
    }
  }

  static Json _withBrowserId(Json result, BrowserConnection c) =>
      c.identityStable ? {...result, 'browserId': c.browserId} : result;

  Json _withPageStateBrowserId(Json result, BrowserConnection c) {
    final enriched = _withBrowserId(result, c);
    final recording = result['recording'];
    if (recording != null) {
      final requested = recording is Map
          ? recording['requestedFilename']
          : null;
      if (requested is! String ||
          !isRecordingResult(recording, requestedFilename: requested)) {
        throw const ExtensionCommandError(
          'page.dialogRespond returned an invalid recording',
        );
      }
      enriched['recording'] = _withBrowserId(
        (recording as Map).cast<String, dynamic>(),
        c,
      );
    }
    final download = result['download'];
    if (download != null) {
      if (!isDownloadResult(download)) {
        throw const ExtensionCommandError(
          'page.dialogRespond returned an invalid download',
        );
      }
      enriched['download'] = _withBrowserId(
        (download as Map).cast<String, dynamic>(),
        c,
      );
    }
    return enriched;
  }

  Future<Json> _snapshotOperation(
    String command,
    Json params,
    BrowserConnection c,
    String? videoFilename,
  ) async {
    if (videoFilename != null) {
      validateRecordingFilename(videoFilename);
      params['videoFilename'] = videoFilename;
    }
    final result = await c.request(command, params);
    if (isDialogResult(result)) return _withBrowserId(_json(result), c);
    if (videoFilename != null) {
      if (!(result is Map &&
          _keys(result, {'operation', 'recording'}) &&
          isPageStateResult(result['operation']) &&
          isRecordingResult(
            result['recording'],
            requestedFilename: videoFilename,
          ))) {
        throw ExtensionCommandError(
          '$command returned an invalid recorded response',
        );
      }
      return {
        'operation': _withBrowserId(_json(result['operation']), c),
        'recording': _withBrowserId(_json(result['recording']), c),
      };
    }
    if (!isPageStateResult(result)) {
      throw ExtensionCommandError('$command returned an invalid response');
    }
    return _withBrowserId(_json(result), c);
  }

  Future<Json> _dictCommand(
    String command,
    Json params,
    String? browserId,
  ) async {
    final c = _connection(browserId);
    final result = await c.request(command, params);
    if (result is! Map) {
      throw ExtensionCommandError('$command returned an invalid response');
    }
    return _withBrowserId(_json(result), c);
  }

  Future<List<Json>> listTabs([String? browserId]) async {
    final c = _connection(browserId);
    final result = await c.request('tabs.list', {});
    if (result is! List) {
      throw const ExtensionCommandError(
        'tabs.list returned an invalid response',
      );
    }
    return [for (final tab in result) _withBrowserId(_json(tab), c)];
  }

  Future<Json> openTab(String url, bool active, [String? browserId]) {
    if (!(url == 'about:blank' || _isHttpUrl(url))) {
      throw const InvalidArgumentError(
        'url must use http://, https://, or be about:blank',
      );
    }
    return _dictCommand('tabs.open', {'url': url, 'active': active}, browserId);
  }

  Future<Json> closeTab(int tabId, [String? browserId]) =>
      _dictCommand('tabs.close', {'tabId': tabId}, browserId);

  Future<Json> selectTab(int tabId, [String? browserId]) =>
      _dictCommand('tabs.select', {'tabId': tabId}, browserId);

  Future<Json> activateTab(int tabId, [String? browserId]) =>
      _dictCommand('tabs.activate', {'tabId': tabId}, browserId);

  Future<Json> snapshot([String? browserId]) async {
    final c = _connection(browserId);
    final result = await c.request('page.snapshot', {});
    if (!isPageStateResult(result)) {
      throw const ExtensionCommandError(
        'page.snapshot returned an invalid response',
      );
    }
    return _withBrowserId(_json(result), c);
  }

  Future<Json> respondToDialog(
    String dialogRef,
    String action, [
    String? promptText,
    String? browserId,
  ]) async {
    if (!RegExp(r'^s[0-9]+d1$').hasMatch(dialogRef)) {
      throw const InvalidArgumentError(
        'dialog_ref must be returned by browser_snapshot',
      );
    }
    if (action != 'accept' && action != 'dismiss') {
      throw const InvalidArgumentError('action must be accept or dismiss');
    }
    final c = _connection(browserId);
    _requireExtension(c, [0, 4, 0]);
    final params = <String, dynamic>{'dialogRef': dialogRef, 'action': action};
    if (promptText != null) params['promptText'] = promptText;
    // A retained download operation can legitimately consume its original
    // 60-second deadline after the dialog response resumes it.
    final result = await c.request(
      'page.dialogRespond',
      params,
      timeout: const Duration(seconds: 65),
    );
    if (!isPageStateResult(result)) {
      throw const ExtensionCommandError(
        'page.dialogRespond returned an invalid response',
      );
    }
    return _withPageStateBrowserId(_json(result), c);
  }

  Future<Json> click(
    String element,
    String ref, [
    String? browserId,
    String? videoFilename,
  ]) {
    if (element.trim().isEmpty) {
      throw const InvalidArgumentError(
        'element must be a non-empty description',
      );
    }
    if (ref.trim().isEmpty) {
      throw const InvalidArgumentError(
        'ref must be returned by browser_snapshot',
      );
    }
    return _snapshotOperation(
      'page.click',
      {'element': element, 'ref': ref},
      _connection(browserId),
      videoFilename,
    );
  }

  Future<Json> hover(
    String element,
    String ref, [
    String? browserId,
    String? videoFilename,
  ]) {
    validateElementRef(element, ref);
    return _snapshotOperation(
      'page.hover',
      {'element': element, 'ref': ref},
      _connection(browserId),
      videoFilename,
    );
  }

  Future<Json> drag(
    String startElement,
    String startRef,
    String endElement,
    String endRef, [
    String? browserId,
    String? videoFilename,
  ]) {
    validateElementRef(startElement, startRef);
    validateElementRef(endElement, endRef);
    return _snapshotOperation(
      'page.drag',
      {
        'startElement': startElement,
        'startRef': startRef,
        'endElement': endElement,
        'endRef': endRef,
      },
      _connection(browserId),
      videoFilename,
    );
  }

  Future<Json> uploadFiles(
    String element,
    String ref,
    List<String> paths, [
    String? browserId,
    String? videoFilename,
  ]) {
    validateElementRef(element, ref);
    final resolved = validateUploadPaths(paths);
    return _snapshotOperation(
      'page.uploadFile',
      {'element': element, 'ref': ref, 'paths': resolved},
      _connection(browserId),
      videoFilename,
    );
  }

  Future<Json> typeText(
    String element,
    String ref,
    String text,
    bool submit, [
    String? browserId,
    String? videoFilename,
  ]) {
    validateElementRef(element, ref);
    return _snapshotOperation(
      'page.type',
      {'element': element, 'ref': ref, 'text': text, 'submit': submit},
      _connection(browserId),
      videoFilename,
    );
  }

  Future<Json> selectOption(
    String element,
    String ref,
    List<String> values, [
    String? browserId,
    String? videoFilename,
  ]) {
    validateElementRef(element, ref);
    if (values.isEmpty) {
      throw const InvalidArgumentError(
        'values must contain at least one option value',
      );
    }
    return _snapshotOperation(
      'page.selectOption',
      {'element': element, 'ref': ref, 'values': values},
      _connection(browserId),
      videoFilename,
    );
  }

  /// `browser_press_key` as MCP shows it: a completion message, or the
  /// dialog, or the message with its recording.
  Future<Object> pressKey(
    String key, [
    String? browserId,
    String? videoFilename,
  ]) async {
    final result = await pressKeyResult(key, browserId, videoFilename);
    if (isDialogResult(result)) return result;
    final completion = 'Pressed key $key';
    if (videoFilename != null) {
      return {'operation': completion, 'recording': result['recording']};
    }
    return completion;
  }

  Future<Json> pressKeyResult(
    String key, [
    String? browserId,
    String? videoFilename,
  ]) async {
    if (key.trim().isEmpty) {
      throw const InvalidArgumentError(
        'key must be a non-empty key name or character',
      );
    }
    if (videoFilename != null) validateRecordingFilename(videoFilename);
    final c = _connection(browserId);
    final params = <String, dynamic>{'key': key};
    if (videoFilename != null) params['videoFilename'] = videoFilename;
    final result = await c.request('page.pressKey', params);
    if (isDialogResult(result)) return _withBrowserId(_json(result), c);
    if (videoFilename != null) {
      if (!(result is Map &&
          _keys(result, {'operation', 'recording'}) &&
          result['operation'] is Map &&
          result['operation']['pressed'] == true &&
          result['operation']['key'] == key &&
          isRecordingResult(
            result['recording'],
            requestedFilename: videoFilename,
          ))) {
        throw const ExtensionCommandError(
          'page.pressKey returned an invalid recorded response',
        );
      }
      return {
        'operation': result['operation'],
        'recording': _withBrowserId(_json(result['recording']), c),
      };
    }
    if (!(result is Map && result['pressed'] == true && result['key'] == key)) {
      throw const ExtensionCommandError(
        'page.pressKey returned an invalid response',
      );
    }
    return _withBrowserId(_json(result), c);
  }

  Future<Json> navigate(
    String url, [
    String? browserId,
    String? videoFilename,
  ]) {
    if (!_isHttpUrl(url)) {
      throw const InvalidArgumentError('url must use http:// or https://');
    }
    return _snapshotOperation(
      'page.navigate',
      {'url': url},
      _connection(browserId),
      videoFilename,
    );
  }

  Future<Json> goBack([String? browserId, String? videoFilename]) =>
      _snapshotOperation(
        'page.goBack',
        {},
        _connection(browserId),
        videoFilename,
      );

  Future<Json> goForward([String? browserId, String? videoFilename]) =>
      _snapshotOperation(
        'page.goForward',
        {},
        _connection(browserId),
        videoFilename,
      );

  /// `browser_wait` as MCP shows it.
  Future<Object> wait(
    num time, [
    String? browserId,
    String? videoFilename,
  ]) async {
    final result = await waitResult(time, browserId, videoFilename);
    if (isDialogResult(result)) return result;
    final completion = 'Waited for ${formatG(time)} seconds';
    if (videoFilename != null) {
      return {'operation': completion, 'recording': result['recording']};
    }
    return completion;
  }

  Future<Json> waitResult(
    num time, [
    String? browserId,
    String? videoFilename,
  ]) async {
    if (!time.isFinite || time < 0 || time > 10) {
      throw const InvalidArgumentError('time must be between 0 and 10 seconds');
    }
    if (videoFilename != null) validateRecordingFilename(videoFilename);
    final c = _connection(browserId);
    final params = <String, dynamic>{'time': time};
    if (videoFilename != null) params['videoFilename'] = videoFilename;
    final result = await c.request('page.wait', params);
    if (isDialogResult(result)) return _withBrowserId(_json(result), c);
    if (videoFilename != null) {
      if (!(result is Map &&
          _keys(result, {'operation', 'recording'}) &&
          result['operation'] is Map &&
          result['operation']['waited'] == true &&
          result['operation']['time'] == time &&
          isRecordingResult(
            result['recording'],
            requestedFilename: videoFilename,
          ))) {
        throw const ExtensionCommandError(
          'page.wait returned an invalid recorded response',
        );
      }
      return {
        'operation': result['operation'],
        'recording': _withBrowserId(_json(result['recording']), c),
      };
    }
    if (!(result is Map &&
        result['waited'] == true &&
        result['time'] == time)) {
      throw const ExtensionCommandError(
        'page.wait returned an invalid response',
      );
    }
    return _withBrowserId(_json(result), c);
  }

  Future<Json> waitFor(
    String text, [
    String state = 'visible',
    num timeout = 10,
    String? browserId,
    String? videoFilename,
  ]) {
    if (text.trim().isEmpty) {
      throw const InvalidArgumentError(
        'text must contain non-whitespace characters',
      );
    }
    if (state != 'visible' && state != 'hidden') {
      throw const InvalidArgumentError('state must be visible or hidden');
    }
    if (!timeout.isFinite || timeout < 0 || timeout > 10) {
      throw const InvalidArgumentError(
        'timeout must be between 0 and 10 seconds',
      );
    }
    final c = _connection(browserId);
    _requireExtension(c, [0, 3, 0]);
    return _snapshotOperation(
      'page.waitFor',
      {'text': text, 'state': state, 'timeout': timeout},
      c,
      videoFilename,
    );
  }

  Future<Json> downloadFile(
    String element,
    String ref, [
    num timeout = 10,
    String? browserId,
  ]) async {
    validateElementRef(element, ref);
    if (!timeout.isFinite || timeout < 0.1 || timeout > 60) {
      throw const InvalidArgumentError(
        'timeout must be between 0.1 and 60 seconds',
      );
    }
    final c = _connection(browserId);
    _requireExtension(c, [0, 3, 0]);
    final result = await c.request('page.downloadFile', {
      'element': element,
      'ref': ref,
      'timeout': timeout,
    }, timeout: Duration(milliseconds: ((timeout + 5) * 1000).round()));
    if (isDialogResult(result)) return _withBrowserId(_json(result), c);
    if (!(result is Map &&
        _keys(result, {'download', 'snapshot'}) &&
        isDownloadResult(result['download']) &&
        isSnapshotResult(result['snapshot']))) {
      throw const ExtensionCommandError(
        'page.downloadFile returned an invalid response',
      );
    }
    return {
      'download': _withBrowserId(_json(result['download']), c),
      'snapshot': _withBrowserId(_json(result['snapshot']), c),
    };
  }

  Future<Json> recordVideo(
    String filename,
    num duration, [
    String? browserId,
  ]) async {
    validateRecordingFilename(filename);
    if (!duration.isFinite || duration < 0.5 || duration > 10) {
      throw const InvalidArgumentError(
        'duration must be between 0.5 and 10 seconds',
      );
    }
    final c = _connection(browserId);
    final result = await c.request('page.recordVideo', {
      'filename': filename,
      'duration': duration,
    });
    if (!isRecordingResult(result, requestedFilename: filename)) {
      throw const ExtensionCommandError(
        'page.recordVideo returned an invalid response',
      );
    }
    return _withBrowserId(_json(result), c);
  }

  Future<Json> screenshotResult([String? browserId]) async {
    final c = _connection(browserId);
    final result = await c.request('page.screenshot', {});
    if (!(result is Map &&
        result['mimeType'] == 'image/png' &&
        result['data'] is String &&
        result['width'] is int &&
        (result['width'] as int) > 0 &&
        result['height'] is int &&
        (result['height'] as int) > 0)) {
      throw const ExtensionCommandError(
        'page.screenshot returned an invalid response',
      );
    }
    final List<int> image;
    try {
      image = base64.decode(result['data'] as String);
    } on FormatException {
      throw const ExtensionCommandError(
        'page.screenshot returned invalid base64 data',
      );
    }
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (image.length < 8 ||
        [for (var i = 0; i < 8; i++) image[i]].join(',') != png.join(',')) {
      throw const ExtensionCommandError(
        'page.screenshot did not return a PNG image',
      );
    }
    return _withBrowserId(_json(result), c);
  }

  Future<List<Json>> consoleLogs([String? browserId]) async {
    final c = _connection(browserId);
    final result = await c.request('page.getConsoleLogs', {});
    if (result is! List || result.length > 100) {
      throw const ExtensionCommandError(
        'page.getConsoleLogs returned an invalid response',
      );
    }
    for (final entry in result) {
      if (!(entry is Map &&
          entry['type'] is String &&
          entry['message'] is String &&
          entry['timestamp'] is num &&
          (entry['timestamp'] as num).isFinite)) {
        throw const ExtensionCommandError(
          'page.getConsoleLogs returned an invalid response',
        );
      }
    }
    return [for (final entry in result) _json(entry)];
  }
}

Json _json(Object? value) => (value as Map).cast<String, dynamic>();

bool _keys(Map value, Set<String> keys) =>
    value.length == keys.length && value.keys.every(keys.contains);

bool _isHttpUrl(String url) =>
    url.startsWith('http://') || url.startsWith('https://');

/// [value] as Python's `{:g}` writes it (`0.5`, `1`, `10`).
String formatG(num value) {
  if (value == value.roundToDouble() && value.abs() < 1e16) {
    return value.toInt().toString();
  }
  return value.toString();
}

void validateElementRef(String element, String ref) {
  if (element.trim().isEmpty) {
    throw const InvalidArgumentError('element must be a non-empty description');
  }
  if (ref.trim().isEmpty) {
    throw const InvalidArgumentError(
      'ref must be returned by browser_snapshot',
    );
  }
}

void validateRecordingFilename(String filename) {
  if (filename.isEmpty) {
    throw const InvalidArgumentError(
      'filename must be a non-empty .webm basename',
    );
  }
  if (filename == '.' ||
      filename == '..' ||
      filename.contains('/') ||
      filename.contains(r'\') ||
      filename.runes.any((r) => r <= 31 || r == 127) ||
      !filename.endsWith('.webm')) {
    throw const InvalidArgumentError(
      'filename must be a .webm basename without path separators or control characters',
    );
  }
  if (utf8.encode(filename).length > 200) {
    throw const InvalidArgumentError(
      'filename must be at most 200 UTF-8 bytes',
    );
  }
}

bool isRecordingResult(Object? result, {required String requestedFilename}) {
  if (result is! Map) return false;
  try {
    validateRecordingFilename(requestedFilename);
  } on InvalidArgumentError {
    return false;
  }
  const expected = {
    'requestedFilename',
    'filename',
    'mimeType',
    'durationMs',
    'width',
    'height',
    'frameCount',
    'droppedFrameCount',
    'sizeBytes',
  };
  if (!_keys(result, expected)) return false;
  for (final name in [
    'durationMs',
    'width',
    'height',
    'frameCount',
    'sizeBytes',
  ]) {
    final v = result[name];
    if (v is! int || v <= 0) return false;
  }
  final dropped = result['droppedFrameCount'];
  final filename = result['filename'];
  return result['requestedFilename'] == requestedFilename &&
      filename is String &&
      filename.startsWith('chrome-bridge/') &&
      !filename.substring('chrome-bridge/'.length).contains('/') &&
      !filename.contains(r'\') &&
      filename.endsWith('.webm') &&
      result['mimeType'] == 'video/webm' &&
      dropped is int &&
      dropped >= 0;
}

List<String> validateUploadPaths(List<String> paths) {
  if (paths.isEmpty || paths.length > 20) {
    throw const InvalidArgumentError(
      'paths must contain between 1 and 20 file paths',
    );
  }
  final resolved = <String>[];
  for (var i = 0; i < paths.length; i++) {
    final value = paths[i];
    if (value.isEmpty) {
      throw const InvalidArgumentError(
        'paths must contain only non-empty strings',
      );
    }
    if (!File(value).isAbsolute) {
      throw InvalidArgumentError('upload path at index $i must be absolute');
    }
    final type = FileSystemEntity.typeSync(value);
    if (type == FileSystemEntityType.notFound) {
      throw InvalidArgumentError('upload file at index $i does not exist');
    }
    final real = File(value).resolveSymbolicLinksSync();
    if (FileSystemEntity.typeSync(real) != FileSystemEntityType.file) {
      throw InvalidArgumentError(
        'upload path at index $i is not a regular file',
      );
    }
    resolved.add(real);
  }
  return resolved;
}

bool isSnapshotResult(Object? r) =>
    r is Map &&
    r['generation'] is int &&
    r['url'] is String &&
    r['title'] is String &&
    r['snapshot'] is String;

bool isDialogResult(Object? r) {
  if (!(r is Map &&
      r['pageState'] == 'browser-dialog' &&
      r['generation'] is int &&
      r['url'] is String &&
      r['title'] is String &&
      r['dialog'] is Map)) {
    return false;
  }
  final dialog = r['dialog'] as Map;
  final type = dialog['type'];
  final actions = dialog['actions'];
  final expected = type == 'alert' ? ['accept'] : ['accept', 'dismiss'];
  return const {'alert', 'confirm', 'prompt', 'beforeunload'}.contains(type) &&
      dialog['message'] is String &&
      dialog['defaultPrompt'] is String &&
      dialog['ref'] == 's${r['generation']}d1' &&
      actions is List &&
      actions.length == expected.length &&
      [
        for (var i = 0; i < expected.length; i++) actions[i] == expected[i],
      ].every((x) => x);
}

bool isPageStateResult(Object? r) => isSnapshotResult(r) || isDialogResult(r);

bool isDownloadResult(Object? r) {
  if (!(r is Map &&
      _keys(r, {'suggestedFilename', 'state', 'receivedBytes', 'totalBytes'}) &&
      r['suggestedFilename'] is String &&
      (r['suggestedFilename'] as String).isNotEmpty &&
      r['state'] == 'complete')) {
    return false;
  }
  return ['receivedBytes', 'totalBytes'].every((n) {
    final v = r[n];
    return v is num && v.isFinite && v >= 0;
  });
}
