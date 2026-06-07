export interface QtMethod {
    name: string;
    signature: string;
    description: string;
    isStatic?: boolean;
    isSignal?: boolean;
    isSlot?: boolean;
}

export interface QtClass {
    name: string;
    description: string;
    header: string;
    methods: QtMethod[];
    inherits?: string;
    docUrl: string;
}

export interface QtMacro {
    name: string;
    description: string;
    snippet?: string;
}

export const QT_CLASSES: QtClass[] = [
    {
        name: 'QObject',
        description: 'The base class of all Qt objects. Provides object trees, signals/slots, and properties.',
        header: 'QObject',
        docUrl: 'https://doc.qt.io/qt-6/qobject.html',
        methods: [
            { name: 'connect', signature: 'connect(sender, signal, receiver, slot)', description: 'Creates a connection between signal and slot.' },
            { name: 'disconnect', signature: 'disconnect(sender, signal, receiver, slot)', description: 'Disconnects signal from slot.' },
            { name: 'findChild', signature: 'findChild<T>(name = QString())', description: 'Finds a child object by name and type.' },
            { name: 'findChildren', signature: 'findChildren<T>(name = QString())', description: 'Finds all child objects by name and type.' },
            { name: 'setProperty', signature: 'setProperty(name, value)', description: 'Sets a dynamic property.' },
            { name: 'property', signature: 'property(name)', description: 'Returns a dynamic property value.' },
            { name: 'deleteLater', signature: 'deleteLater()', description: 'Schedules the object for deletion.', isSlot: true },
            { name: 'destroyed', signature: 'destroyed(QObject* = nullptr)', description: 'Emitted before the object is destroyed.', isSignal: true }
        ]
    },
    {
        name: 'QWidget',
        description: 'The base class of all user interface objects.',
        header: 'QWidget',
        docUrl: 'https://doc.qt.io/qt-6/qwidget.html',
        inherits: 'QObject',
        methods: [
            { name: 'show', signature: 'show()', description: 'Shows the widget and its child widgets.', isSlot: true },
            { name: 'hide', signature: 'hide()', description: 'Hides the widget.', isSlot: true },
            { name: 'close', signature: 'close()', description: 'Closes the widget.', isSlot: true },
            { name: 'setWindowTitle', signature: 'setWindowTitle(title)', description: 'Sets the window title.' },
            { name: 'setWindowIcon', signature: 'setWindowIcon(icon)', description: 'Sets the window icon.' },
            { name: 'setLayout', signature: 'setLayout(layout)', description: 'Sets the layout manager.' },
            { name: 'resize', signature: 'resize(width, height)', description: 'Resizes the widget.' },
            { name: 'move', signature: 'move(x, y)', description: 'Moves the widget to position.' },
            { name: 'setEnabled', signature: 'setEnabled(enabled)', description: 'Enables or disables the widget.' },
            { name: 'setVisible', signature: 'setVisible(visible)', description: 'Shows or hides the widget.', isSlot: true },
            { name: 'update', signature: 'update()', description: 'Updates the widget.', isSlot: true },
            { name: 'repaint', signature: 'repaint()', description: 'Repaints the widget immediately.', isSlot: true },
            { name: 'setStyleSheet', signature: 'setStyleSheet(styleSheet)', description: 'Sets the widget stylesheet.' },
            { name: 'setGeometry', signature: 'setGeometry(x, y, w, h)', description: 'Sets widget geometry.' },
            { name: 'setFixedSize', signature: 'setFixedSize(w, h)', description: 'Sets a fixed size.' },
            { name: 'setMinimumSize', signature: 'setMinimumSize(w, h)', description: 'Sets the minimum size.' },
            { name: 'setMaximumSize', signature: 'setMaximumSize(w, h)', description: 'Sets the maximum size.' },
            { name: 'raise', signature: 'raise()', description: 'Raises widget to top of parent stack.', isSlot: true },
            { name: 'lower', signature: 'lower()', description: 'Lowers widget to bottom of parent stack.', isSlot: true },
            { name: 'showFullScreen', signature: 'showFullScreen()', description: 'Shows widget in full screen mode.', isSlot: true },
            { name: 'showMaximized', signature: 'showMaximized()', description: 'Shows widget maximized.', isSlot: true },
            { name: 'showMinimized', signature: 'showMinimized()', description: 'Shows widget minimized.', isSlot: true },
            { name: 'showNormal', signature: 'showNormal()', description: 'Restores widget to normal state.', isSlot: true }
        ]
    },
    {
        name: 'QMainWindow',
        description: 'Main application window with menu bar, toolbars, dock widgets, and status bar.',
        header: 'QMainWindow',
        docUrl: 'https://doc.qt.io/qt-6/qmainwindow.html',
        inherits: 'QWidget',
        methods: [
            { name: 'setCentralWidget', signature: 'setCentralWidget(widget)', description: 'Sets the central widget.' },
            { name: 'centralWidget', signature: 'centralWidget()', description: 'Returns the central widget.' },
            { name: 'setMenuBar', signature: 'setMenuBar(menuBar)', description: 'Sets the menu bar.' },
            { name: 'menuBar', signature: 'menuBar()', description: 'Returns the menu bar.' },
            { name: 'setStatusBar', signature: 'setStatusBar(statusbar)', description: 'Sets the status bar.' },
            { name: 'statusBar', signature: 'statusBar()', description: 'Returns the status bar.' },
            { name: 'addToolBar', signature: 'addToolBar(title)', description: 'Adds a tool bar.' },
            { name: 'addDockWidget', signature: 'addDockWidget(area, dockwidget)', description: 'Adds a dock widget.' }
        ]
    },
    {
        name: 'QString',
        description: 'Unicode character string. The Qt alternative to std::string.',
        header: 'QString',
        docUrl: 'https://doc.qt.io/qt-6/qstring.html',
        methods: [
            { name: 'append', signature: 'append(str)', description: 'Appends a string.' },
            { name: 'prepend', signature: 'prepend(str)', description: 'Prepends a string.' },
            { name: 'contains', signature: 'contains(str, cs = Qt::CaseSensitive)', description: 'Returns true if string contains str.' },
            { name: 'startsWith', signature: 'startsWith(str, cs = Qt::CaseSensitive)', description: 'Returns true if string starts with str.' },
            { name: 'endsWith', signature: 'endsWith(str, cs = Qt::CaseSensitive)', description: 'Returns true if string ends with str.' },
            { name: 'split', signature: 'split(sep, behavior = Qt::KeepEmptyParts, cs = Qt::CaseSensitive)', description: 'Splits string into a list.' },
            { name: 'trimmed', signature: 'trimmed()', description: 'Returns string with whitespace removed from both ends.' },
            { name: 'simplified', signature: 'simplified()', description: 'Returns string with whitespace normalized.' },
            { name: 'toInt', signature: 'toInt(ok = nullptr, base = 10)', description: 'Converts string to int.' },
            { name: 'toDouble', signature: 'toDouble(ok = nullptr)', description: 'Converts string to double.' },
            { name: 'toUtf8', signature: 'toUtf8()', description: 'Returns UTF-8 encoded byte array.' },
            { name: 'fromUtf8', signature: 'fromUtf8(str)', description: 'Creates QString from UTF-8.', isStatic: true },
            { name: 'number', signature: 'number(n, base = 10)', description: 'Returns string representation of number.', isStatic: true },
            { name: 'arg', signature: 'arg(a, fieldWidth = 0, base = 10, fillChar = QLatin1Char(\' \'))', description: 'Replaces %1, %2, etc. with arguments.' },
            { name: 'isEmpty', signature: 'isEmpty()', description: 'Returns true if string has no characters.' },
            { name: 'isNull', signature: 'isNull()', description: 'Returns true if string is null.' },
            { name: 'length', signature: 'length()', description: 'Returns the number of characters.' },
            { name: 'mid', signature: 'mid(position, n = -1)', description: 'Returns substring starting at position.' },
            { name: 'left', signature: 'left(n)', description: 'Returns leftmost n characters.' },
            { name: 'right', signature: 'right(n)', description: 'Returns rightmost n characters.' },
            { name: 'replace', signature: 'replace(before, after)', description: 'Replaces occurrences of before with after.' },
            { name: 'toLower', signature: 'toLower()', description: 'Returns lowercase copy.' },
            { name: 'toUpper', signature: 'toUpper()', description: 'Returns uppercase copy.' }
        ]
    },
    {
        name: 'QVector',
        description: 'Template class that provides a dynamic array.',
        header: 'QVector',
        docUrl: 'https://doc.qt.io/qt-6/qvector.html',
        methods: [
            { name: 'append', signature: 'append(value)', description: 'Appends value to end.' },
            { name: 'prepend', signature: 'prepend(value)', description: 'Prepends value to beginning.' },
            { name: 'insert', signature: 'insert(i, value)', description: 'Inserts value at index i.' },
            { name: 'remove', signature: 'remove(i, n = 1)', description: 'Removes n elements starting at i.' },
            { name: 'removeAt', signature: 'removeAt(i)', description: 'Removes element at index i.' },
            { name: 'removeOne', signature: 'removeOne(value)', description: 'Removes first occurrence of value.' },
            { name: 'removeAll', signature: 'removeAll(value)', description: 'Removes all occurrences of value.' },
            { name: 'contains', signature: 'contains(value)', description: 'Returns true if vector contains value.' },
            { name: 'indexOf', signature: 'indexOf(value, from = 0)', description: 'Returns index of first occurrence.' },
            { name: 'isEmpty', signature: 'isEmpty()', description: 'Returns true if vector is empty.' },
            { name: 'size', signature: 'size()', description: 'Returns number of elements.' },
            { name: 'count', signature: 'count()', description: 'Returns number of elements.' },
            { name: 'first', signature: 'first()', description: 'Returns first element.' },
            { name: 'last', signature: 'last()', description: 'Returns last element.' },
            { name: 'clear', signature: 'clear()', description: 'Removes all elements.' },
            { name: 'reserve', signature: 'reserve(size)', description: 'Attempts to allocate memory for size elements.' },
            { name: 'squeeze', signature: 'squeeze()', description: 'Releases any memory not required.' }
        ]
    },
    {
        name: 'QList',
        description: 'Template class that provides a list.',
        header: 'QList',
        docUrl: 'https://doc.qt.io/qt-6/qlist.html',
        methods: [
            { name: 'append', signature: 'append(value)', description: 'Appends value to end.' },
            { name: 'prepend', signature: 'prepend(value)', description: 'Prepends value to beginning.' },
            { name: 'insert', signature: 'insert(i, value)', description: 'Inserts value at index i.' },
            { name: 'removeAt', signature: 'removeAt(i)', description: 'Removes element at index i.' },
            { name: 'removeOne', signature: 'removeOne(value)', description: 'Removes first occurrence of value.' },
            { name: 'removeAll', signature: 'removeAll(value)', description: 'Removes all occurrences of value.' },
            { name: 'contains', signature: 'contains(value)', description: 'Returns true if list contains value.' },
            { name: 'indexOf', signature: 'indexOf(value, from = 0)', description: 'Returns index of first occurrence.' },
            { name: 'isEmpty', signature: 'isEmpty()', description: 'Returns true if list is empty.' },
            { name: 'size', signature: 'size()', description: 'Returns number of elements.' },
            { name: 'first', signature: 'first()', description: 'Returns first element.' },
            { name: 'last', signature: 'last()', description: 'Returns last element.' },
            { name: 'clear', signature: 'clear()', description: 'Removes all elements.' },
            { name: 'takeAt', signature: 'takeAt(i)', description: 'Removes and returns element at i.' },
            { name: 'takeFirst', signature: 'takeFirst()', description: 'Removes and returns first element.' },
            { name: 'takeLast', signature: 'takeLast()', description: 'Removes and returns last element.' }
        ]
    },
    {
        name: 'QMap',
        description: 'Template class that provides a red-black-tree-based dictionary.',
        header: 'QMap',
        docUrl: 'https://doc.qt.io/qt-6/qmap.html',
        methods: [
            { name: 'insert', signature: 'insert(key, value)', description: 'Inserts key-value pair.' },
            { name: 'remove', signature: 'remove(key)', description: 'Removes key and its value.' },
            { name: 'contains', signature: 'contains(key)', description: 'Returns true if map contains key.' },
            { name: 'value', signature: 'value(key, defaultValue = T())', description: 'Returns value for key or default.' },
            { name: 'key', signature: 'key(value, defaultKey = Key())', description: 'Returns first key for value.' },
            { name: 'keys', signature: 'keys()', description: 'Returns all keys.' },
            { name: 'values', signature: 'values()', description: 'Returns all values.' },
            { name: 'isEmpty', signature: 'isEmpty()', description: 'Returns true if map is empty.' },
            { name: 'size', signature: 'size()', description: 'Returns number of elements.' },
            { name: 'clear', signature: 'clear()', description: 'Removes all elements.' },
            { name: 'find', signature: 'find(key)', description: 'Returns iterator to key.' }
        ]
    },
    {
        name: 'QPushButton',
        description: 'Command button widget.',
        header: 'QPushButton',
        docUrl: 'https://doc.qt.io/qt-6/qpushbutton.html',
        inherits: 'QAbstractButton',
        methods: [
            { name: 'setText', signature: 'setText(text)', description: 'Sets the button text.' },
            { name: 'text', signature: 'text()', description: 'Returns the button text.' },
            { name: 'setIcon', signature: 'setIcon(icon)', description: 'Sets the button icon.' },
            { name: 'setCheckable', signature: 'setCheckable(checkable)', description: 'Sets whether button is checkable.' },
            { name: 'setChecked', signature: 'setChecked(checked)', description: 'Sets the checked state.', isSlot: true },
            { name: 'setFlat', signature: 'setFlat(flat)', description: 'Sets flat appearance.' },
            { name: 'setDefault', signature: 'setDefault(isDefault)', description: 'Sets as default button.' },
            { name: 'click', signature: 'click()', description: 'Performs a click.', isSlot: true },
            { name: 'toggle', signature: 'toggle()', description: 'Toggles the button state.', isSlot: true },
            { name: 'clicked', signature: 'clicked(checked = false)', description: 'Emitted when button is activated.', isSignal: true },
            { name: 'pressed', signature: 'pressed()', description: 'Emitted when button is pressed.', isSignal: true },
            { name: 'released', signature: 'released()', description: 'Emitted when button is released.', isSignal: true },
            { name: 'toggled', signature: 'toggled(checked)', description: 'Emitted when checkable state changes.', isSignal: true }
        ]
    },
    {
        name: 'QLabel',
        description: 'Text or image display widget.',
        header: 'QLabel',
        docUrl: 'https://doc.qt.io/qt-6/qlabel.html',
        inherits: 'QFrame',
        methods: [
            { name: 'setText', signature: 'setText(text)', description: 'Sets the label text.' },
            { name: 'text', signature: 'text()', description: 'Returns the label text.' },
            { name: 'setPixmap', signature: 'setPixmap(pixmap)', description: 'Sets the label pixmap.' },
            { name: 'setWordWrap', signature: 'setWordWrap(on)', description: 'Enables/disables word wrap.' },
            { name: 'setAlignment', signature: 'setAlignment(alignment)', description: 'Sets text alignment.' },
            { name: 'setTextFormat', signature: 'setTextFormat(format)', description: 'Sets text format (PlainText, RichText, etc.).' },
            { name: 'setTextInteractionFlags', signature: 'setTextInteractionFlags(flags)', description: 'Sets text interaction behavior.' },
            { name: 'setOpenExternalLinks', signature: 'setOpenExternalLinks(open)', description: 'Opens external links automatically.' },
            { name: 'setBuddy', signature: 'setBuddy(buddy)', description: 'Sets the buddy widget.' },
            { name: 'clear', signature: 'clear()', description: 'Clears contents.', isSlot: true }
        ]
    },
    {
        name: 'QLineEdit',
        description: 'One-line text editor widget.',
        header: 'QLineEdit',
        docUrl: 'https://doc.qt.io/qt-6/qlineedit.html',
        inherits: 'QWidget',
        methods: [
            { name: 'setText', signature: 'setText(text)', description: 'Sets the line edit text.' },
            { name: 'text', signature: 'text()', description: 'Returns the current text.' },
            { name: 'setPlaceholderText', signature: 'setPlaceholderText(text)', description: 'Sets placeholder text.' },
            { name: 'setMaxLength', signature: 'setMaxLength(maxLength)', description: 'Sets maximum text length.' },
            { name: 'setReadOnly', signature: 'setReadOnly(readOnly)', description: 'Sets read-only state.' },
            { name: 'setEchoMode', signature: 'setEchoMode(mode)', description: 'Sets echo mode (Normal, Password, etc.).' },
            { name: 'setValidator', signature: 'setValidator(validator)', description: 'Sets input validator.' },
            { name: 'clear', signature: 'clear()', description: 'Clears the contents.', isSlot: true },
            { name: 'selectAll', signature: 'selectAll()', description: 'Selects all text.', isSlot: true },
            { name: 'setSelection', signature: 'setSelection(start, length)', description: 'Sets text selection.' },
            { name: 'textChanged', signature: 'textChanged(text)', description: 'Emitted when text changes.', isSignal: true },
            { name: 'textEdited', signature: 'textEdited(text)', description: 'Emitted when text is edited by user.', isSignal: true },
            { name: 'returnPressed', signature: 'returnPressed()', description: 'Emitted when Return/Enter is pressed.', isSignal: true },
            { name: 'editingFinished', signature: 'editingFinished()', description: 'Emitted when editing is finished.', isSignal: true }
        ]
    },
    {
        name: 'QMessageBox',
        description: 'Modal dialog for informing or querying the user.',
        header: 'QMessageBox',
        docUrl: 'https://doc.qt.io/qt-6/qmessagebox.html',
        inherits: 'QDialog',
        methods: [
            { name: 'information', signature: 'information(parent, title, text, buttons = Ok)', description: 'Displays info dialog.', isStatic: true },
            { name: 'warning', signature: 'warning(parent, title, text, buttons = Ok)', description: 'Displays warning dialog.', isStatic: true },
            { name: 'critical', signature: 'critical(parent, title, text, buttons = Ok)', description: 'Displays critical dialog.', isStatic: true },
            { name: 'question', signature: 'question(parent, title, text, buttons = ...)', description: 'Displays question dialog.', isStatic: true },
            { name: 'setText', signature: 'setText(text)', description: 'Sets primary text.' },
            { name: 'setInformativeText', signature: 'setInformativeText(text)', description: 'Sets informative text.' },
            { name: 'setDetailedText', signature: 'setDetailedText(text)', description: 'Sets detailed text.' },
            { name: 'setIcon', signature: 'setIcon(icon)', description: 'Sets dialog icon.' },
            { name: 'setStandardButtons', signature: 'setStandardButtons(buttons)', description: 'Sets standard buttons.' },
            { name: 'setDefaultButton', signature: 'setDefaultButton(button)', description: 'Sets default button.' },
            { name: 'exec', signature: 'exec()', description: 'Shows modal dialog and returns result.' }
        ]
    },
    {
        name: 'QFile',
        description: 'Interface for reading from and writing to files.',
        header: 'QFile',
        docUrl: 'https://doc.qt.io/qt-6/qfile.html',
        inherits: 'QIODevice',
        methods: [
            { name: 'open', signature: 'open(mode)', description: 'Opens file with mode (ReadOnly, WriteOnly, etc.).' },
            { name: 'close', signature: 'close()', description: 'Closes the file.' },
            { name: 'exists', signature: 'exists()', description: 'Returns true if file exists.', isStatic: true },
            { name: 'remove', signature: 'remove()', description: 'Removes the file.' },
            { name: 'rename', signature: 'rename(newName)', description: 'Renames the file.' },
            { name: 'copy', signature: 'copy(newName)', description: 'Copies the file.' },
            { name: 'size', signature: 'size()', description: 'Returns file size in bytes.' },
            { name: 'fileName', signature: 'fileName()', description: 'Returns the file name.' },
            { name: 'setFileName', signature: 'setFileName(name)', description: 'Sets the file name.' },
            { name: 'readAll', signature: 'readAll()', description: 'Reads all remaining data.' },
            { name: 'write', signature: 'write(data)', description: 'Writes data to file.' },
            { name: 'flush', signature: 'flush()', description: 'Flushes buffered data to file.' },
            { name: 'readLine', signature: 'readLine(maxlen = 0)', description: 'Reads one line from file.' }
        ]
    },
    {
        name: 'QTimer',
        description: 'Repetitive and single-shot timers.',
        header: 'QTimer',
        docUrl: 'https://doc.qt.io/qt-6/qtimer.html',
        inherits: 'QObject',
        methods: [
            { name: 'start', signature: 'start(msec)', description: 'Starts timer with interval in ms.', isSlot: true },
            { name: 'stop', signature: 'stop()', description: 'Stops the timer.', isSlot: true },
            { name: 'setInterval', signature: 'setInterval(msec)', description: 'Sets timer interval.' },
            { name: 'setSingleShot', signature: 'setSingleShot(singleShot)', description: 'Sets single-shot mode.' },
            { name: 'isActive', signature: 'isActive()', description: 'Returns true if timer is running.' },
            { name: 'timeout', signature: 'timeout()', description: 'Emitted when timer times out.', isSignal: true },
            { name: 'singleShot', signature: 'singleShot(msec, receiver, member)', description: 'Static single-shot timer.', isStatic: true }
        ]
    }
];

export const QT_MACROS: QtMacro[] = [
    { name: 'Q_OBJECT', description: 'Must appear in the private section of a class declaration that declares its own signals and slots.' },
    { name: 'SIGNAL', description: 'Macro that converts a method signature to a signal signature for connect().', snippet: 'SIGNAL(${1:signal}(${2:args}))' },
    { name: 'SLOT', description: 'Macro that converts a method signature to a slot signature for connect().', snippet: 'SLOT(${1:slot}(${2:args}))' },
    { name: 'Q_PROPERTY', description: 'Declares a property in a QObject-derived class.', snippet: 'Q_PROPERTY(${1:type} ${2:name} READ ${3:getter} WRITE ${4:setter})' },
    { name: 'Q_INVOKABLE', description: 'Marks a method as invokable from QML or QMetaObject::invokeMethod().' },
    { name: 'Q_ENUM', description: 'Registers an enum type with the meta-object system.' },
    { name: 'Q_FLAG', description: 'Registers a flags type with the meta-object system.' },
    { name: 'Q_SLOTS', description: 'Marks subsequent methods as slots.' },
    { name: 'Q_SIGNALS', description: 'Marks subsequent methods as signals.' },
    { name: 'emit', description: 'Emits a signal. (Actually a no-op macro; used for readability.)' },
    { name: 'Q_ASSERT', description: 'Prints a warning message containing the source code file name and line number if test is false.', snippet: 'Q_ASSERT(${1:condition});' },
    { name: 'Q_DEBUG', description: 'Writes a debug message to the console.', snippet: 'qDebug() << ${1:message};' },
    { name: 'Q_FOREACH', description: 'Qt\'s foreach loop macro.', snippet: 'Q_FOREACH(${1:type} ${2:item}, ${3:container}) {\n\t$0\n}' },
    { name: 'tr', description: 'Marks a string for translation.', snippet: 'tr("${1:text}")' },
    { name: 'QT_TR_NOOP', description: 'Marks a string for translation without actually translating it.', snippet: 'QT_TR_NOOP("${1:text}")' },
    { name: 'Q_DECLARE_METATYPE', description: 'Makes a type available to QVariant and queued signal-slot connections.', snippet: 'Q_DECLARE_METATYPE(${1:Type})' },
    { name: 'qApp', description: 'Global pointer to the application object. Equivalent to QCoreApplication::instance().' }
];

// Build lookup maps for fast access
const classByName = new Map<string, QtClass>();
for (const cls of QT_CLASSES) {
    classByName.set(cls.name, cls);
}

export function findQtClass(name: string): QtClass | undefined {
    return classByName.get(name);
}

export function findQtMethod(className: string, methodName: string): QtMethod | undefined {
    const cls = classByName.get(className);
    if (!cls) { return undefined; }
    return cls.methods.find(m => m.name === methodName);
}

export function searchQtClasses(prefix: string): QtClass[] {
    const lower = prefix.toLowerCase();
    return QT_CLASSES.filter(c => c.name.toLowerCase().startsWith(lower));
}

export function searchQtMethods(className: string, prefix: string): QtMethod[] {
    const cls = classByName.get(className);
    if (!cls) { return []; }
    const lower = prefix.toLowerCase();
    return cls.methods.filter(m => m.name.toLowerCase().startsWith(lower));
}

export function searchQtMacros(prefix: string): QtMacro[] {
    const lower = prefix.toLowerCase();
    return QT_MACROS.filter(m => m.name.toLowerCase().startsWith(lower));
}
