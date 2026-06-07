#!/usr/bin/env python3
"""
Qt Pretty Printers for GDB and LLDB
====================================
Provides human-readable display of common Qt types in the debugger.

Usage with GDB:
    (gdb) source /path/to/qt_pretty_printers.py

Usage with LLDB:
    (lldb) command script import /path/to/qt_pretty_printers.py

Supported types:
    QString, QByteArray, QList, QVector, QMap, QHash, QVariant,
    QUrl, QDateTime, QDate, QTime
"""

import gdb
import gdb.printing


class QStringPrinter:
    """Pretty printer for QString (Qt5 and Qt6)."""

    def __init__(self, val):
        self.val = val

    def to_string(self):
        try:
            # Qt6: QString uses d pointer with utf16 data
            d = self.val['d']
            size = int(d['size'])
            if size == 0:
                return '""'
            # Try to read utf16 data
            ptr = d['ptr']
            data = ptr.string(encoding='utf-16', length=size)
            return f'"{data}"'
        except Exception:
            try:
                # Qt5 fallback: d.data or d->data
                d = self.val['d']
                data_ptr = d['data']
                if data_ptr:
                    return f'"{data_ptr.string()}"'
                return '""'
            except Exception:
                return '<QString (unable to read)>'

    def display_hint(self):
        return 'string'


class QByteArrayPrinter:
    """Pretty printer for QByteArray."""

    def __init__(self, val):
        self.val = val

    def to_string(self):
        try:
            d = self.val['d']
            size = int(d['size'])
            if size == 0:
                return 'b""'
            data = d['data']
            raw = bytearray()
            for i in range(min(size, 100)):
                raw.append(int((data + i).dereference()) & 0xff)
            preview = raw.decode('utf-8', errors='replace')
            if size > 100:
                preview += f'... ({size} bytes total)'
            return f'b"{preview}"'
        except Exception:
            return '<QByteArray (unable to read)>'

    def display_hint(self):
        return 'string'


class QListPrinter:
    """Pretty printer for QList / QVector."""

    def __init__(self, val):
        self.val = val
        self.typename = str(val.type)

    def to_string(self):
        try:
            d = self.val['d']
            size = int(d['size'])
            return f'{self.typename} of length {size}'
        except Exception:
            return f'{self.typename}'

    def children(self):
        try:
            d = self.val['d']
            size = int(d['size'])
            begin = int(d['begin'])
            array = d['array']
            for i in range(min(size, 50)):
                idx = (begin + i) % (int(d['alloc']) if 'alloc' in d else size + 1)
                try:
                    elem = (array + idx).dereference()
                    yield f'[{i}]', elem
                except Exception:
                    yield f'[{i}]', '<unreadable>'
        except Exception:
            pass

    def display_hint(self):
        return 'array'


class QVectorPrinter:
    """Pretty printer for QVector (shares logic with QList in Qt6)."""

    def __init__(self, val):
        self.val = val
        self.typename = str(val.type)

    def to_string(self):
        try:
            d = self.val['d']
            size = int(d['size'])
            return f'{self.typename} of length {size}'
        except Exception:
            return f'{self.typename}'

    def children(self):
        try:
            d = self.val['d']
            size = int(d['size'])
            ptr = d['ptr']
            for i in range(min(size, 50)):
                try:
                    elem = (ptr + i).dereference()
                    yield f'[{i}]', elem
                except Exception:
                    yield f'[{i}]', '<unreadable>'
        except Exception:
            pass

    def display_hint(self):
        return 'array'


class QMapPrinter:
    """Pretty printer for QMap / QHash."""

    def __init__(self, val):
        self.val = val
        self.typename = str(val.type)

    def to_string(self):
        try:
            d = self.val['d']
            size = int(d['size'])
            return f'{self.typename} with {size} elements'
        except Exception:
            return f'{self.typename}'

    def children(self):
        try:
            d = self.val['d']
            size = int(d['size'])
            # QMap stores nodes in a tree; simplistic traversal
            root = d['root']
            if not root:
                return
            nodes = [root]
            count = 0
            while nodes and count < 30:
                node = nodes.pop(0)
                try:
                    key = node['key']
                    value = node['value']
                    yield f'[{count}]', f'{key}: {value}'
                    count += 1
                    left = node['left']
                    right = node['right']
                    if left:
                        nodes.append(left)
                    if right:
                        nodes.append(right)
                except Exception:
                    break
        except Exception:
            pass

    def display_hint(self):
        return 'map'


class QVariantPrinter:
    """Pretty printer for QVariant (Qt5 and Qt6)."""

    def __init__(self, val):
        self.val = val

    def to_string(self):
        try:
            # Qt6: d.typeId
            d = self.val['d']
            type_id = int(d['typeId'])
            type_name = self._type_name(type_id)
            try:
                data = d['data']
                return f'QVariant({type_name}) = {data}'
            except Exception:
                return f'QVariant({type_name})'
        except Exception:
            try:
                # Qt5 fallback
                d = self.val['d']
                type_id = int(d['type'])
                type_name = self._type_name(type_id)
                return f'QVariant({type_name})'
            except Exception:
                return '<QVariant (unable to read)>'

    def _type_name(self, type_id):
        # Common Qt metatype IDs (Qt6)
        type_map = {
            1: 'bool', 2: 'int', 3: 'uint', 4: 'qlonglong', 5: 'qulonglong',
            6: 'double', 7: 'QChar', 8: 'QVariantMap', 9: 'QVariantList',
            10: 'QString', 11: 'QStringList', 12: 'QByteArray', 13: 'QBitArray',
            14: 'QDate', 15: 'QTime', 16: 'QDateTime', 17: 'QUrl',
            18: 'QLocale', 19: 'QRect', 20: 'QRectF', 21: 'QSize',
            22: 'QSizeF', 23: 'QLine', 24: 'QLineF', 25: 'QPoint',
            26: 'QPointF', 27: 'QVariantHash', 28: 'QVariant', 29: 'QModelIndex',
            30: 'QPersistentModelIndex', 31: 'QUuid', 32: 'QByteArrayList',
            33: 'QFont', 34: 'QPixmap', 35: 'QBrush', 36: 'QColor',
            37: 'QPalette', 38: 'QIcon', 39: 'QImage', 40: 'QPolygon',
            41: 'QRegion', 42: 'QBitmap', 43: 'QCursor', 44: 'QKeySequence',
            45: 'QPen', 46: 'QTextLength', 47: 'QTextFormat', 48: 'QMatrix',
            49: 'QTransform', 50: 'QMatrix4x4', 51: 'QVector2D',
            52: 'QVector3D', 53: 'QVector4D', 54: 'QQuaternion',
            55: 'QPolygonF',
        }
        return type_map.get(type_id, f'typeId={type_id}')


class QUrlPrinter:
    """Pretty printer for QUrl."""

    def __init__(self, val):
        self.val = val

    def to_string(self):
        try:
            # Try to reconstruct URL from d->scheme + d->host + d->path
            d = self.val['d']
            scheme = d['scheme'].string() if d['scheme'] else ''
            host = d['host'].string() if d['host'] else ''
            path = d['path'].string() if d['path'] else ''
            url = ''
            if scheme:
                url += scheme + '://'
            if host:
                url += host
            url += path
            return f'QUrl("{url}")'
        except Exception:
            return '<QUrl (unable to read)>'


class QDateTimePrinter:
    """Pretty printer for QDateTime."""

    def __init__(self, val):
        self.val = val

    def to_string(self):
        try:
            d = self.val['d']
            # QDateTime stores msecs since epoch
            msecs = int(d['msecs'])
            secs = msecs // 1000
            from datetime import datetime, timezone
            dt = datetime.fromtimestamp(secs, tz=timezone.utc)
            return f'QDateTime({dt.isoformat()})'
        except Exception:
            return '<QDateTime (unable to read)>'


class QDatePrinter:
    """Pretty printer for QDate."""

    def __init__(self, val):
        self.val = val

    def to_string(self):
        try:
            # Julian day number
            jd = int(self.val['jd'])
            # Approximate conversion (simplified)
            from datetime import datetime, timedelta
            dt = datetime(2000, 1, 1) + timedelta(days=jd - 2451545)
            return f'QDate({dt.strftime("%Y-%m-%d")})'
        except Exception:
            return '<QDate (unable to read)>'


class QTimePrinter:
    """Pretty printer for QTime."""

    def __init__(self, val):
        self.val = val

    def to_string(self):
        try:
            # Milliseconds since midnight
            mds = int(self.val['mds'])
            hours = mds // 3600000
            minutes = (mds % 3600000) // 60000
            seconds = (mds % 60000) // 1000
            millis = mds % 1000
            return f'QTime({hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d})'
        except Exception:
            return '<QTime (unable to read)>'


class QtPrettyPrinter(gdb.printing.PrettyPrinter):
    """Collection of Qt pretty printers."""

    def __init__(self):
        super().__init__("Qt", {})

    def __call__(self, val):
        typename = str(val.type.strip_typedefs())

        if typename.startswith('QString'):
            return QStringPrinter(val)
        if typename.startswith('QByteArray'):
            return QByteArrayPrinter(val)
        if typename.startswith('QList<'):
            return QListPrinter(val)
        if typename.startswith('QVector<'):
            return QVectorPrinter(val)
        if typename.startswith('QMap<') or typename.startswith('QHash<'):
            return QMapPrinter(val)
        if typename.startswith('QVariant'):
            return QVariantPrinter(val)
        if typename.startswith('QUrl'):
            return QUrlPrinter(val)
        if typename.startswith('QDateTime'):
            return QDateTimePrinter(val)
        if typename.startswith('QDate'):
            return QDatePrinter(val)
        if typename.startswith('QTime'):
            return QTimePrinter(val)

        return None


def register_qt_printers():
    """Register Qt pretty printers with the current GDB session."""
    printer = QtPrettyPrinter()
    gdb.printing.register_pretty_printer(gdb.current_objfile(), printer)
    print("Qt pretty printers registered successfully.")


# Auto-register when sourced
register_qt_printers()
