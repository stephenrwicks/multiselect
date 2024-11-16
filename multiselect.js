"use strict";
class MultiSelect extends HTMLElement {
    static formAssociated = true;
    static observedAttributes = [
        'disabled',
        'empty-text',
        'max',
        'min',
        'name',
        'open',
        'required',
        'show-search',
        'show-select-all',
        'selected-text',
    ];
    #initialized = false;
    #internals = this.attachInternals(); // Allows the custom element to work with native forms
    #native = document.createElement('select'); // Native select element is stored in memory
    #map = new Map();
    #groupMap = new Map();
    #textContainer = document.createElement('span');
    #optionContainer = document.createElement('div');
    #searchInput = document.createElement('input');
    #searchContainer = (() => {
        const container = document.createElement('div');
        container.classList.add('multi-select-search-container');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '10');
        circle.setAttribute('cy', '10');
        circle.setAttribute('r', '7');
        circle.setAttribute('stroke', 'currentColor');
        circle.setAttribute('stroke-width', '2');
        circle.setAttribute('fill', 'none');
        svg.appendChild(circle);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '15');
        line.setAttribute('y1', '15');
        line.setAttribute('x2', '21');
        line.setAttribute('y2', '21');
        line.setAttribute('stroke', 'currentColor');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);
        container.append(this.#searchInput, svg);
        this.#searchInput.type = 'text';
        this.#searchInput.spellcheck = false;
        this.#searchInput.addEventListener('input', () => {
            this.#search(this.#searchInput.value);
        });
        return container;
    })();
    #selectAllCheckbox = document.createElement('input');
    #selectAllOption = (() => {
        const label = document.createElement('label');
        const span = document.createElement('span');
        this.#selectAllCheckbox.type = 'checkbox';
        this.#selectAllCheckbox.setAttribute('form', '');
        this.#selectAllCheckbox.tabIndex = -1;
        label.append(this.#selectAllCheckbox, span);
        span.textContent = 'Select All';
        label.classList.add('multi-select-select-all-label');
        label.tabIndex = 0;
        label.role = 'option';
        label.ariaLabel = 'Select All';
        label.ariaSelected = String(this.#selectAllCheckbox.checked);
        return label;
    })();
    #childObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            if (mutation.type !== 'childList')
                continue;
            const el = mutation.addedNodes[0];
            if (el instanceof HTMLOptGroupElement || el instanceof HTMLOptionElement) {
                this.add(el);
            }
            else if (el instanceof Element) {
                el.remove();
            }
        }
    });
    #optionAttributeObserver = new MutationObserver(mutations => {
        // This allows us to modify the native <option> and have it reflected in the checkbox
        for (const mutation of mutations) {
            if (mutation.type !== 'attributes')
                continue;
            if (mutation.target instanceof HTMLOptionElement) {
                const option = mutation.target;
                const checkbox = this.#map.get(option);
                if (!checkbox)
                    continue;
                if (mutation.attributeName === 'disabled') {
                    checkbox.disabled = option.hasAttribute('disabled');
                    checkbox.parentElement.tabIndex = checkbox.disabled ? -1 : 0;
                }
                else if (mutation.attributeName === 'label') {
                    if (!checkbox.nextElementSibling)
                        continue;
                    checkbox.nextElementSibling.textContent = option.label || option.text;
                }
                else if (mutation.attributeName === 'selected') {
                    // KNOWN ISSUE: option.selected = true does NOT reach this code, unlike the other attributes.
                    // Have to use setAttribute
                    checkbox.checked = option.hasAttribute('selected');
                }
                else if (mutation.attributeName === 'value') {
                    checkbox.value = option.value;
                }
            }
            // This lets us modify the optgroup name as well
            if (mutation.target instanceof HTMLOptGroupElement) {
                const optgroup = mutation.target;
                const fieldset = this.#groupMap.get(optgroup);
                if (!fieldset)
                    continue;
                if (mutation.attributeName === 'label') {
                    fieldset.firstElementChild.textContent = optgroup.label;
                }
            }
        }
    });
    constructor() {
        super();
    }
    connectedCallback() {
        if (!this.#initialized) {
            this.#init();
        }
        this.#childObserver.observe(this, { childList: true });
        this.#optionAttributeObserver.observe(this.#native, { attributes: true, subtree: true });
    }
    #init() {
        // Things that should only happen once go here
        this.append(this.#textContainer, this.#buildChevron(), this.#optionContainer);
        this.addEventListener('click', this.toggle);
        this.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' || e.key === 'Enter')
                return;
            if (e.target === this.#searchInput)
                return;
            e.preventDefault();
            if (e.key === ' ') {
                this.toggle();
                this.#focusableOpts[0]?.focus();
            }
        });
        this.#optionContainer.addEventListener('keydown', this.#handleKeydown);
        this.#optionContainer.addEventListener('click', (e) => e.stopPropagation());
        this.#optionContainer.addEventListener('change', this.#handleChange);
        this.#updateDisplay();
        this.#updateValidity();
        this.#updateFormData();
        this.tabIndex = 0;
        this.dataset.multiSelectTheme ??= '';
        this.#native.multiple = true;
        this.#optionContainer.tabIndex = -1;
        this.#optionContainer.ariaLabel = 'Options';
        this.role = 'combobox';
        this.ariaHasPopup = 'listbox';
        this.ariaExpanded = 'false';
        this.#optionContainer.role = 'listbox';
        this.#optionContainer.ariaMultiSelectable = 'true';
        this.#initialized = true;
    }
    disconnectedCallback() {
        this.#childObserver.disconnect();
        this.#optionAttributeObserver.disconnect();
    }
    formAssociatedCallback() {
        this.#updateFormData();
    }
    attributeChangedCallback(name, oldValue, newValue) {
        // Is updateValidity() necessary after changes
        if (name === 'disabled') {
            this.#disabled = this.hasAttribute('disabled');
            if (this.#disabled)
                this.ariaDisabled = 'true';
            else
                this.removeAttribute('aria-disabled');
        }
        else if (name === 'empty-text') {
            this.emptyText = newValue;
        }
        else if (name === 'max') {
            newValue = Number(newValue);
            if (isNaN(newValue))
                return;
            this.#max = newValue;
            this.#updateValidity();
        }
        else if (name === 'min') {
            newValue = Number(newValue);
            if (isNaN(newValue))
                return;
            if (newValue > this.length)
                newValue = this.length;
            this.#min = newValue;
            this.#updateValidity();
        }
        else if (name === 'name') {
            this.#name = newValue;
        }
        else if (name === 'open') {
            if (this.hasAttribute('open'))
                this.show();
            else
                this.hide();
        }
        else if (name === 'required') {
            this.#required = this.hasAttribute('required');
            if (this.#required)
                this.ariaRequired = 'true';
            else
                this.removeAttribute('aria-required');
            this.#updateValidity();
        }
        else if (name === 'selected-text') {
            this.selectedText = newValue;
        }
        else if (name === 'show-search') {
            this.showSearch = this.hasAttribute('show-search');
        }
        else if (name === 'show-select-all') {
            this.showSelectAll = this.hasAttribute('show-select-all');
        }
    }
    #dismiss = (e) => {
        // For events, we use arrow function to maintain correct "this" context
        // (could also use .bind())
        if (e.target === this)
            return;
        if (e.target === this.#optionContainer)
            return;
        if (this.#optionContainer.contains(e.target))
            return;
        this.hide();
    };
    #handleChange = (e) => {
        if (e.target === this.#selectAllCheckbox) {
            if (this.#selectAllCheckbox.checked) {
                this.#selectVisible();
            }
            else {
                this.#deselectVisible();
            }
        }
        else {
            for (const [option, checkbox] of this.#map) {
                option.selected = checkbox.checked;
                checkbox.parentElement.ariaSelected = String(checkbox.checked);
            }
        }
        this.#updateSelectAllCheckbox();
        this.#updateDisplay();
        this.#updateValidity();
        this.#updateFormData();
    };
    #handleKeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
            this.hide();
            this.focus();
            return;
        }
        if (e.target instanceof HTMLLabelElement) {
            // Can improve this with shift + arrow
            e.preventDefault();
            const checkbox = e.target.firstElementChild;
            if (e.key === ' ') {
                checkbox.checked = !checkbox.checked;
                if (checkbox === this.#selectAllCheckbox) {
                    if (this.#selectAllCheckbox.checked) {
                        this.#selectVisible();
                    }
                    else {
                        this.#deselectVisible();
                    }
                    return;
                }
                this.#optionContainer.dispatchEvent(new Event('change'));
            }
            else if (e.key === 'ArrowUp') {
                const i = this.#focusableOpts.indexOf(e.target);
                if (i === 0) {
                    if (this.#showSearch)
                        this.#searchInput.focus();
                    return;
                }
                this.#focusableOpts[i - 1]?.focus();
            }
            else if (e.key === 'ArrowDown') {
                const i = this.#focusableOpts.indexOf(e.target);
                if (i === this.#focusableOpts.length - 1)
                    return;
                this.#focusableOpts[i + 1]?.focus();
            }
            else if (e.key === 'Home' || e.key === 'PageUp') {
                this.#focusableOpts[0]?.focus();
            }
            else if (e.key === 'End' || e.key === 'PageDown') {
                this.#focusableOpts[this.#focusableOpts.length - 1]?.focus();
            }
        }
        if (e.target === this.#searchInput && e.key === 'ArrowDown') {
            e.preventDefault();
            this.#focusableOpts[0]?.focus();
        }
    };
    get #focusableOpts() {
        return [...this.#optionContainer.querySelectorAll('label:not(:has([disabled]))')];
    }
    #buildChevron() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('width', '24');
        svg.setAttribute('height', '24');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        path.setAttribute('d', 'M6 9l6 6 6-6');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.append(path);
        return svg;
    }
    #buildGroup(optgroup) {
        const groupContainer = document.createElement('fieldset');
        const groupLabel = document.createElement('legend');
        const children = [...optgroup.children].filter(el => el instanceof HTMLOptionElement);
        groupContainer.setAttribute('form', '');
        groupContainer.role = 'group';
        groupLabel.textContent = optgroup.label;
        groupContainer.append(groupLabel, ...children.map(option => this.#buildOption(option)));
        this.#groupMap.set(optgroup, groupContainer);
        return groupContainer;
    }
    #buildOption(option) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        const span = document.createElement('span');
        checkbox.type = 'checkbox';
        checkbox.tabIndex = -1;
        checkbox.value = option.value;
        checkbox.setAttribute('form', '');
        checkbox.checked = option.selected;
        checkbox.disabled = option.disabled;
        span.textContent = option.label || option.text;
        label.append(checkbox, span);
        label.tabIndex = option.disabled ? -1 : 0;
        label.role = 'option';
        label.ariaSelected = String(checkbox.checked);
        label.ariaLabel = option.label || option.text;
        if (checkbox.disabled)
            label.ariaDisabled = 'true';
        this.#map.set(option, checkbox);
        return label;
    }
    #search(searchText = '') {
        searchText = searchText.toLocaleLowerCase().trim();
        for (const [option, checkbox] of this.#map) {
            if (!searchText) {
                checkbox.parentElement.style.display = '';
                continue;
            }
            if (option.label.toLocaleLowerCase().includes(searchText) || option.text.toLocaleLowerCase().includes(searchText)) {
                checkbox.parentElement.style.display = '';
            }
            else {
                checkbox.parentElement.style.display = 'none';
            }
        }
        // Hide empty groups
        for (const el of this.#optionContainer.children) {
            if (!(el instanceof HTMLFieldSetElement))
                continue;
            el.style.display = [...el.children].some(o => o instanceof HTMLLabelElement && o.style.display !== 'none') ? '' : 'none';
        }
        this.#updateSelectAllCheckbox();
    }
    #updateSelectAllCheckbox() {
        this.#selectAllCheckbox.checked = !!this.visibleOptions.length && (this.visibleOptions.every(o => o.selected || o.disabled));
        if (this.visibleOptions.every(o => o.disabled))
            this.#selectAllCheckbox.checked = false;
        this.#selectAllCheckbox.ariaSelected = String(this.#selectAllCheckbox.checked);
        this.#selectAllCheckbox.indeterminate = !this.#selectAllCheckbox.checked && this.visibleOptions.some(o => o.selected);
    }
    #updateDisplay() {
        if (!this.value.length) {
            this.#textContainer.textContent = this.#emptyText || '---Select---';
        }
        else if (this.value.length === 1) {
            this.#textContainer.textContent = this.#native.selectedOptions[0].label;
        }
        else {
            this.#textContainer.textContent = `${this.value.length} ${this.#selectedText || 'selected'}`;
        }
    }
    #updateValidity() {
        const selectedLength = this.selectedOptions.length;
        const hasSelections = !!selectedLength;
        const hasMin = !!this.min;
        const hasMax = !!this.max;
        const minMaxEqual = hasMax && hasMin && this.min === this.max;
        const underMin = hasMin && selectedLength < this.min;
        const overMax = hasMax && selectedLength > this.max;
        // check min max, check if higher than number of options
        this.#internals.setValidity({}); // Clear validity
        if (hasSelections || this.required) {
            if (underMin) {
                if (hasMin && hasMax && minMaxEqual) {
                    this.#internals.setValidity({
                        valueMissing: !hasSelections,
                        rangeUnderflow: true
                    }, `Please select ${this.min} item${this.min > 1 ? 's' : ''}.`);
                }
                else if (hasMin && hasMax) {
                    this.#internals.setValidity({
                        valueMissing: !hasSelections,
                        rangeUnderflow: true
                    }, `Please select ${this.min}-${this.max} item(s).`);
                }
                else {
                    this.#internals.setValidity({
                        valueMissing: !hasSelections,
                        rangeUnderflow: true
                    }, `Please select at least ${this.min} item${this.min > 1 ? 's' : ''}.`);
                }
                return;
            }
            if (overMax) {
                if (hasMin && hasMax && minMaxEqual) {
                    this.#internals.setValidity({ rangeOverflow: true }, `Please select ${this.min} item(s).`);
                }
                else if (hasMin && hasMax) {
                    this.#internals.setValidity({ rangeOverflow: true }, `Please select ${this.min}-${this.max} item(s).`);
                }
                else {
                    this.#internals.setValidity({ rangeOverflow: true }, `Please only select up to ${this.max} item(s).`);
                }
                return;
            }
            if (!hasSelections && this.required) {
                this.#internals.setValidity({ valueMissing: true }, `Please select an item from this list.`);
            }
        }
    }
    #updateFormData() {
        // This works with FormData the same as native select[multiple].
        // Rather than appending an array, it sends up a separate entry for each option selected.
        const formData = new FormData();
        for (const selectedOption of this.#native.selectedOptions) {
            formData.append(this.name, selectedOption.value);
        }
        this.#internals.setFormValue(formData);
    }
    // Full list of every native <select> method / property as of November 2024
    // https://developer.mozilla.org/en-US/docs/Web/API/HTMLSelectElement
    // I am trying to fully replace select[multiple] -- so I am including every method / property
    // === NATIVE PROPERTIES === These exist on the regular HTML select element
    get autocomplete() {
        return 'Not implemented in custom multi-select';
    }
    #disabled = false;
    get disabled() {
        return this.#disabled;
    }
    set disabled(val) {
        this.#disabled = !!val;
        this.#disabled ? this.setAttribute('disabled', '') : this.removeAttribute('disabled');
        if (this.#disabled) {
            this.ariaDisabled = 'true';
        }
        else {
            this.removeAttribute('aria-disabled');
        }
        this.#updateDisplay();
        this.#updateValidity();
    }
    get form() {
        return this.#internals.form;
    }
    get labels() {
        return this.#internals.labels;
    }
    get length() {
        return this.options.length;
    }
    get multiple() {
        // May update this if I choose to include single select mode
        return true;
    }
    #name = '';
    get name() {
        return this.#name;
    }
    set name(val) {
        if (typeof val !== 'string')
            return;
        this.#name = val;
    }
    get options() {
        return this.#native.options;
    }
    #required = false;
    get required() {
        return this.#required;
    }
    set required(val) {
        this.#required = !!val;
        this.#required ? this.setAttribute('required', '') : this.removeAttribute('required');
        this.#updateValidity();
    }
    get selectedIndex() {
        return this.#native.selectedIndex;
    }
    get selectedOptions() {
        return this.#native.selectedOptions;
    }
    get size() {
        return 0;
    }
    get type() {
        if (this.multiple)
            return 'select-multiple';
        return 'select-one';
    }
    get validationMessage() {
        return this.#internals.validationMessage;
    }
    get validity() {
        return this.#internals.validity;
    }
    get value() {
        // This is different from native select[multiple] behavior, but it's better. This is what jQuery does.
        // Native selects only return the first selected value, even with "multiple" enabled.
        return [...this.#native.selectedOptions].map(o => o.value);
    }
    set value(val) {
        // Pass in array
        if (!Array.isArray(val))
            return;
        this.#native.value = '';
        for (const option of this.#native.options) {
            option.selected = val.includes(option.value);
            const checkbox = this.#map.get(option);
            if (checkbox) {
                checkbox.checked = option.selected;
                checkbox.parentElement.ariaSelected = String(option.selected);
            }
        }
        this.#updateDisplay();
        this.#updateSelectAllCheckbox();
        this.#updateValidity();
        this.#updateFormData();
    }
    get willValidate() {
        return this.#internals.willValidate;
    }
    // NATIVE METHODS
    add(option, before) {
        if (!(option instanceof HTMLOptionElement) && !(option instanceof HTMLOptGroupElement))
            return;
        this.#native.add(option, before);
        // "before" is not yet supported
        if (option instanceof HTMLOptionElement)
            this.#optionContainer.append(this.#buildOption(option));
        else if (option instanceof HTMLOptGroupElement)
            this.#optionContainer.append(this.#buildGroup(option));
        this.#updateSelectAllCheckbox();
        this.#updateDisplay();
        this.#updateValidity();
        this.#updateFormData();
    }
    checkValidity() {
        return this.#internals.checkValidity();
    }
    item(index) {
        return this.#native.item(index);
    }
    namedItem(name) {
        return this.#native.namedItem(name);
    }
    remove(index) {
        if (typeof index === 'undefined')
            super.remove();
        if (typeof index !== 'number')
            return;
        if (index > this.#native.options.length)
            return;
        const option = this.#native.options[index];
        const checkbox = this.#map.get(option);
        if (!checkbox)
            return;
        checkbox.parentElement?.remove();
        this.#map.delete(option);
        this.#native.remove(index);
        this.#updateSelectAllCheckbox();
        this.#updateDisplay();
        this.#updateValidity();
        this.#updateFormData();
    }
    reportValidity() {
        return this.#internals.reportValidity();
    }
    setCustomValidity(validityMessage) {
        if (validityMessage) {
            this.#internals.setValidity({ customError: true }, validityMessage);
        }
        else {
            this.#updateValidity();
        }
    }
    showPicker() {
        this.show();
    }
    // CUSTOM PROPERTIES
    #emptyText = '---Select---';
    get emptyText() {
        return this.#emptyText;
    }
    set emptyText(val) {
        this.#emptyText = val;
        this.#updateDisplay();
    }
    #max;
    get max() {
        return this.#max;
    }
    set max(max) {
        max = Number(max);
        if (isNaN(max) || max < 0)
            max = 0;
        if (max > this.length)
            max = this.length;
        if (!!this.min && max < this.min)
            this.min = max;
        this.#max = max;
        this.setAttribute('max', String(max));
        this.#updateValidity();
    }
    #min;
    get min() {
        return this.#min;
    }
    set min(min) {
        min = Number(min);
        if (isNaN(min) || min < 0)
            min = 0;
        if (min > this.length)
            min = this.length;
        if (!!this.max && min > this.max)
            this.max = min;
        this.#min = min;
        this.setAttribute('min', String(min));
        this.#updateValidity();
    }
    get optgroups() {
        return [...this.#native.children].filter(child => child instanceof HTMLOptGroupElement);
    }
    #open = false;
    get open() {
        return this.#open;
    }
    set open(val) {
        !!val ? this.show() : this.hide();
    }
    get optionsAsObjects() {
        return [...this.options].map(o => {
            return {
                id: o.id,
                label: o.label,
                text: o.text,
                value: o.value,
                selected: o.selected
            };
        });
    }
    get selectedOptionsAsObjects() {
        return [...this.selectedOptions].map(o => {
            return {
                id: o.id,
                label: o.label,
                text: o.text,
                value: o.value,
                selected: o.selected
            };
        });
    }
    // Might want to rename this because it looks weird next to selectedOptions
    #selectedText = 'selected';
    get selectedText() {
        return this.#selectedText;
    }
    set selectedText(val) {
        this.#selectedText = val;
        this.#updateDisplay();
    }
    #showSearch = false;
    get showSearch() {
        return this.#showSearch;
    }
    set showSearch(val) {
        this.#showSearch = !!val;
        if (this.#showSearch) {
            if (this.#showSelectAll)
                this.#selectAllOption.before(this.#searchContainer);
            this.#optionContainer.prepend(this.#searchContainer);
        }
        else {
            this.#searchContainer.remove();
            this.#search('');
        }
    }
    #showSelectAll = false;
    get showSelectAll() {
        return this.#showSelectAll;
    }
    set showSelectAll(val) {
        this.#showSelectAll = !!val;
        if (this.#showSelectAll) {
            if (this.#showSearch)
                this.#searchContainer.after(this.#selectAllOption);
            else
                this.#optionContainer.prepend(this.#selectAllOption);
        }
        else
            this.#selectAllOption.remove();
    }
    // Returns options not hidden by search
    get visibleOptions() {
        return [...this.options].filter(o => {
            const checkbox = this.#map.get(o);
            if (!checkbox)
                return false;
            if (checkbox.parentElement?.style?.display === 'none')
                return false;
            return true;
        });
    }
    // CUSTOM METHODS
    alphabetize(asc = true) {
    }
    deselectAll() {
        this.value = [];
    }
    #deselectVisible() {
        const val = [];
        // This is the opposite
        for (const [option, checkbox] of this.#map) {
            if (checkbox.disabled)
                continue;
            if (checkbox.parentElement?.style?.display !== 'none')
                continue;
            val.push(option.value);
        }
        this.value = val;
    }
    hide() {
        if (!this.#open)
            return;
        this.#optionContainer.style.display = 'none';
        this.#open = false;
        this.removeAttribute('open');
        this.ariaExpanded = 'false';
        document.removeEventListener('click', this.#dismiss);
    }
    selectAll() {
        this.value = [...this.options].filter(o => !o.disabled).map(o => o.value);
    }
    #selectVisible() {
        this.value = this.visibleOptions.filter(o => !o.disabled).map(o => o.value);
    }
    show() {
        if (this.#open)
            return;
        this.#optionContainer.style.display = 'block';
        this.#open = true;
        this.setAttribute('open', '');
        this.ariaExpanded = 'true';
        document.addEventListener('click', this.#dismiss);
    }
    shuffleOptions() {
    }
    toggle() {
        if (this.#open)
            this.hide();
        else
            this.show();
    }
    toggleSelectAll() {
        if (this.value.length === [...this.options].filter(o => !o.disabled).length)
            this.deselectAll();
        else
            this.selectAll();
    }
}
customElements.define('multi-select', MultiSelect);
// to do -
// check if we can get string init to work with .innerhtml check
// constructor init so that new MultiSelect(options) works
// more css
// shuffle and alphabetize methods
// disableOption method
// better type safety
