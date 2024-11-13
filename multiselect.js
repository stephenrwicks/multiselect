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
        // <option>s that are included directly in the HTML are not available immediately,
        // so we use a mutation observer with a callback to initialize them properly as soon as they are ready
        // mutationObserver.disconnect(); // Could leave this to listen for later ones
        // mutationObserver = null as any;
        for (const mutation of mutations) {
            if (mutation.type !== 'childList')
                continue;
            const el = mutation.addedNodes[0];
            if (el instanceof HTMLOptGroupElement || el instanceof HTMLOptionElement) {
                this.add(el);
            }
            else if (el instanceof HTMLElement) {
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
                }
                else if (mutation.attributeName === 'label') {
                    if (!checkbox.nextElementSibling)
                        continue;
                    checkbox.nextElementSibling.textContent = option.label || option.text;
                }
                else if (mutation.attributeName === 'selected') {
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
        this.#updateDisplay();
        this.#updateValidity();
        this.#updateFormData();
        this.tabIndex = 0;
        this.dataset.multiSelectTheme ??= 'default';
        this.#native.multiple = true;
        this.#optionContainer.tabIndex = -1;
        this.#optionContainer.ariaLabel = 'Options';
        this.role = 'combobox';
        this.ariaHasPopup = 'listbox';
        this.ariaExpanded = 'false';
        this.#optionContainer.role = 'listbox';
        this.#optionContainer.ariaMultiSelectable = 'true';
    }
    #init() {
        // Things that should only happen once go here
        this.append(this.#textContainer, this.#buildChevron(), this.#optionContainer);
        this.addEventListener('click', this.toggle);
        this.addEventListener('keydown', (e) => {
            if (e.target === this.#searchInput)
                return;
            if (e.key === 'Tab')
                return;
            e.preventDefault();
            if (e.key === 'ArrowDown') {
                this.#optionContainer.firstElementChild?.focus();
            }
            else if (e.key === ' ' || e.key === 'Enter') {
                this.toggle();
            }
        });
        this.#optionContainer.addEventListener('click', (e) => e.stopPropagation());
        this.#optionContainer.addEventListener('change', this.#handleChange);
        this.#optionContainer.addEventListener('keydown', this.#handleKeydown);
        this.#initialized = true;
    }
    disconnectedCallback() {
        this.#childObserver.disconnect();
        this.#optionAttributeObserver.disconnect();
    }
    formAssociatedCallback() {
        // We would have to do something like this in order to allow FormData to accept multiple entries like select[multiple], I think.
        // This is not great because the element can also switch forms and we have no direct access
        // this.form?.addEventListener('formdata', () => {
        // append individual values
        //     alert('a');
        // })
        // could try associating the native with the form.
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
            this.#max = newValue;
            this.#updateValidity();
        }
        else if (name === 'min') {
            if (Number(newValue) > this.length)
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
                this.selectAll(false);
            }
            else {
                this.deselectAll();
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
        // e.stopPropagation();
        // if (e.key === 'Tab') return;
        // e.preventDefault();
        // if (e.key === 'ArrowUp') {
        //     if (!label.previousElementSibling) {
        //         this.focus();
        //         return;
        //     }
        //     (label.previousElementSibling as HTMLLabelElement)?.focus();
        // }
        // else if (e.key === 'ArrowDown') {
        //     (label.nextElementSibling as HTMLLabelElement)?.focus();
        // }
        // else if (e.key === 'Home' || e.key === 'PageUp') {
        //     (this.#optionContainer.firstElementChild as HTMLLabelElement)?.focus();
        // }
        // else if (e.key === 'End' || e.key === 'PageDown') {
        //     (this.#optionContainer.lastElementChild as HTMLLabelElement)?.focus();
        // }
        // else if (e.key === ' ' || e.key === 'Enter') {
        //     checkbox.checked = !checkbox.checked;
        //     this.#optionContainer.dispatchEvent(new Event('change'));
        // }
    };
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
        label.tabIndex = 0;
        label.role = 'option';
        label.ariaSelected = String(checkbox.checked);
        label.ariaLabel = option.label || option.text;
        if (checkbox.disabled)
            label.ariaDisabled = 'true';
        // // Shouldn't be able to tab or arrow to a disabled option
        // // move keydown to optionContainer and handle everything
        // label.addEventListener('keydown', (e) => {
        //     this.#handleKeydown(e);
        // });
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
        this.#updateSelectAllCheckbox();
    }
    #updateSelectAllCheckbox() {
        this.#selectAllCheckbox.checked = !!this.visibleOptions.length && (this.visibleOptions.every(o => o.selected));
        this.#selectAllCheckbox.ariaSelected = String(this.#selectAllCheckbox.checked);
        this.#selectAllCheckbox.indeterminate = !this.#selectAllCheckbox.checked && this.visibleOptions.some(o => o.selected);
    }
    #updateDisplay() {
        if (!this.value.length) {
            this.#textContainer.textContent = this.#emptyText || '---Select---';
        }
        else if (this.value.length === 1) {
            this.#textContainer.textContent = this.#native.selectedOptions[0].textContent;
        }
        else {
            this.#textContainer.textContent = `${this.value.length} ${this.#selectedText || 'selected'}`;
        }
    }
    // #checkMinMax() {
    //     const hasMin = typeof this.min !== 'undefined';
    //     const hasMax = typeof this.max !== 'undefined';
    //     if (hasMax && this.max < this.length) this.max = this.length; // This could cause infinite loops
    // }
    // #getValidityMessage() {
    //     let message = '';
    //     const hasMin = typeof this.min !== 'undefined' && this.min !== 0;
    //     const hasMax = typeof this.max !== 'undefined' && this.max !== 0;
    //     return message;
    // }
    #updateValidity() {
        this.#internals.setValidity({}); // Clear
        const selectedLength = this.selectedOptions.length;
        const hasSelections = !!selectedLength;
        return;
        if (!this.required && !hasSelections)
            return; // Valid if empty and not required
        if (this.required && hasSelections) {
        }
        else if (!this.required && hasSelections) {
        }
        else if (this.required && !hasSelections) {
            let message = 'Please select an item in the list';
            this.#internals.setValidity({ valueMissing: true });
        }
        return;
        // Check if min / max is higher than the number of options
        const hasMin = typeof this.min !== 'undefined' && this.min !== 0;
        const hasMax = typeof this.max !== 'undefined' && this.max !== 0;
        if (hasMin && hasMax && (this.min > this.max)) {
            this.min = this.max;
        }
        const isValidEmpty = !this.required && selectedLength === 0;
        const underMin = hasMin && selectedLength < this.min;
        const overMax = hasMax && selectedLength > this.max;
        let message;
        if (this.required && selectedLength === 0) {
            message = 'This field is required.'; // should display min/max
        }
        else if (hasMin && hasMax && this.min === this.max) {
            message = `You must select ${this.min} options.`;
        }
        else if (hasMin && hasMax && (underMin || overMax)) {
            message = `You must select ${this.min}-${this.max} options.`;
        }
        else if (underMin) {
            message = `You must select at least ${this.min} options.`;
        }
        else if (overMax) {
            message = `You can only select up to ${this.max} options.`;
        }
        else {
            message = '';
        }
        if (isValidEmpty)
            return;
        if (this.required) {
            this.#internals.setValidity({ valueMissing: true }, message);
        }
        if (underMin) {
            this.#internals.setValidity({ rangeUnderflow: true }, message);
        }
        if (overMax) {
            this.#internals.setValidity({ rangeOverflow: true }, message);
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
    //     Instance properties
    //     autocomplete -- Omitted
    //     disabled -- Same as "disabled" attribute, locks element
    //     form - Form associated with element
    //     labels - Returns a NodeList of any labels associated (either with "for" or as ancestor elements)
    //     length - Number of options
    //     multiple - Always true
    //     name - Same as "name" attribute
    //     options - HTMLOptionsCollection
    //     required - Same as "required" attribute
    //     selectedIndex - Index of first selected option
    //     selectedOptions - HTMLCollectionOf<HTMLOptionElement> - Interestingly, this is natively a different type than "options"
    //     size - Set to 0 always. This can be handled by CSS
    //     type - This is either "select-multiple" or "select-one"
    //     validationMessage - Current native validation message, blank string if valid
    //     validity - ValidityState object
    //     value - Is implemented differently from the native select
    //     willValidate - Determines whether element is a candidate for constraint validation (true if not disabled, etc.)
    //     Instance methods
    //     add() - Add option or optgroup
    //     checkValidity() - Returns boolean
    //     item()
    //     namedItem()
    //     remove() - Removes option if index is included. This is an overload, because it also removes the element if no arguments are given
    //     reportValidity() - Shows validation message and returns boolean
    //     setCustomValidity() - Change validity message, or set to blank string to clear it
    //     showPicker() - Open the dropdown. Same as show(), which is custom
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
        // This is pretty complicated, since we have to get for="" and ancestor labels, without duplicating them, and put them in a NodeList and not a 
        if (!this.id)
            return document.querySelectorAll('');
        // We would also have to return parent label elements
        return document.querySelectorAll(`label[for="${this.id}"]`);
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
        this.#max = max;
        // Max could be 0 in which case we might want to remove the attribute
        this.setAttribute('max', String(max));
        this.#updateValidity();
    }
    #min;
    get min() {
        return this.#min;
    }
    set min(min) {
        if (min > this.length)
            min = this.length;
        this.#min = min;
        this.setAttribute('min', String(min));
        this.#updateValidity();
    }
    get optGroups() {
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
    hide() {
        if (!this.#open)
            return;
        this.#optionContainer.style.display = 'none';
        this.#open = false;
        this.removeAttribute('open');
        this.ariaExpanded = 'false';
        document.removeEventListener('click', this.#dismiss);
    }
    selectAll(includeHidden = true) {
        if (includeHidden) {
            this.value = [...this.options].map(o => o.value);
        }
        else {
            this.value = this.visibleOptions.map(o => o.value);
        }
    }
    show() {
        if (this.#open)
            return;
        this.#optionContainer.style.display = 'grid';
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
        if (this.value.length === this.length)
            this.deselectAll();
        else
            this.selectAll();
    }
}
customElements.define('multi-select', MultiSelect);
